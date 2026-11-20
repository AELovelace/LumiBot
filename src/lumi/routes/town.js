'use strict';

/**
 * Lumi Town / Lumi City presence, chat, emotes, the live stream, and visiting each other's homes
 * (erinne mnemerynne/web/games.py pet_town ... pet_house_here, ported with the same rules and words).
 *   POST /api/lumi-pet/town                 where her Lumi stands; who else is in view; recent lines
 *   POST /api/lumi-pet/town/say             a line (typed or a phrase) where she is
 *   POST /api/lumi-pet/town/emote           wave, dance ... where she is
 *   GET  /api/lumi-pet/town/stream          SSE: said, moved, walk, emote, city, guestbook, knock, answer, home
 *   GET  /api/lumi-pet/houses               whose flats she may visit
 *   GET  /api/lumi-pet/houses/:host         someone's flat (?home=house: their house on a plot)
 *   POST /api/lumi-pet/houses/:host/knock   knock (an open door just lets her in)
 *   GET  /api/lumi-pet/knocks/:id           a knock's answer (for the knocker)
 *   POST /api/lumi-pet/knocks/:id/answer    the host lets them in, or not now
 *   POST /api/lumi-pet/houses/:host/guestbook  sign it (a guest who is in)
 *   POST /api/lumi-pet/houses/here          where she stands in a home; who else is there; knocks; house-warming gift
 * Coins: the house-warming gift is sgc.pay(..., 'pet', 'housewarm', 'lumi-housewarm:<me>:<host>:<day>'), at most
 * HOUSEWARM_PER_DAY different homes a day (erinne HOUSEWARMING_CAP / HOUSEWARMING = 30 / 10).
 * Dropped from erinne: the TV play pass (pet_user), lumi-pet/tv/player, push, push/off and /sw.js.
 */

const { tx, dayKey, getDb } = require('../db');
const sgc = require('../sgc');
const save = require('../pet/save');
const events = require('../events');
const { LumiError, notFound, forbidden, conflict, tooMany } = require('../errors');
const lumipet = require('../pet/lumipet');
const lumihouse = require('../pet/lumihouse');
const lumitown = require('../town/lumitown');
const lumicity = require('../city/lumicity');
const { form } = require('../town/forms');

const { HOUSES } = lumihouse;                                                       // who's in which home
const { TOWN, CHANNEL } = lumitown;                                                 // who's in town
const SIGN_GAP = 600;                                                               // one guestbook line per visitor per flat every 10 minutes
const HOUSEWARMING = 10;                                                            // native SGC for the first visit of the day to a friend's home
const HOUSEWARM_PER_DAY = 3;                                                        // erinne HOUSEWARMING_CAP 30 / 10: three homes a day
const HOME_PLACES = ['house:', 'home:'];                                            // lumihouse.place prefixes
const UID_RE = /^\d{1,25}$/u;                                                       // a Discord id

/** Where this person is now: in a home or in town, whichever they said most recently. */
function whereNow(uid) {
  const inHouse = HOUSES.seenAt(uid);                                               // last ping in a home
  const inTown = TOWN.seenAt(uid);                                                  // last ping in town
  if (inHouse !== null && (inTown === null || inHouse >= inTown)) return HOUSES.where(uid); // a home
  return TOWN.where(uid);                                                           // town (or null)
}

const atHome = (where) => Boolean(where) && HOME_PLACES.some((p) => where.startsWith(p)); // a home place?

/** The host in a path, as a Discord id; anything else is "no flat there" (404). */
function hostParam(ctx) {
  const host = String(ctx.params.host || '');                                       // the path piece
  if (!UID_RE.test(host)) throw notFound("There's no flat there.");                 // not an id
  return host;                                                                      // Discord id string
}

/** A 422 with the words a cleaner threw (erinne HTTPException 422). */
function unprocessable(message) {
  return new LumiError(422, 'invalid', message);                                    // FastAPI 422
}

/** erinne _relay: one town event as `me`'s stream hears it: [event, data] or null. walkPlace: where she was lately. */
function relay(kind, data, me, walkPlace) {
  if (kind === 'moved') return ['moved', {}];                                       // someone arrived, left or moved
  if (kind === 'said') {                                                            // a line said in the same place
    const said = data.line || {};                                                   // the line
    return said.uid !== me && said.place === whereNow(me) ? ['said', said] : null;  // not her own; same place
  }
  if (kind === 'walk') return data.uid !== me && lumitown.near(walkPlace, data.place) ? ['walk', data] : null; // a step she can see
  if (kind === 'city') return ['city', {}];                                         // a plot changed: fetch the city again
  if (kind === 'emote') {                                                           // someone where she is waved ...
    return data.uid !== me && data.place === whereNow(me) ? ['emote', { uid: data.uid, emote: data.emote }] : null;
  }
  if (kind === 'guestbook' && data.host === me) return ['guestbook', {}];           // someone signed her guestbook
  if (kind === 'knock' && data.host === me) return ['knock', {}];                   // at her door
  if (kind === 'answer' && data.guest === me) return ['answer', { host: data.host, yes: Boolean(data.yes) }]; // her knock, answered
  if (kind === 'home' && (data.out || []).includes(me)) return ['home', { host: data.host }]; // shown out of a home
  return null;                                                                      // not for her
}

/** Publish one town event (erinne events.publish_sync(lumitown.CHANNEL, {kind, ...})). */
function publish(kind, data = {}) {
  events.publish(CHANNEL, kind, { kind, ...data });                                 // event name = kind
}

// erinne TownHere.
const TOWN_FORM = {
  at: { type: 'str', pattern: /^[a-z][a-z0-9-]{0,23}$/u },                          // a place or door id
  street: { type: 'str', choices: ['high', 'market'], nullable: true, default: null }, // old pages: ignored
  inside: { type: 'bool', default: false },                                         // inside that place?
  district: { type: 'str', pattern: /^(down|[lr]\d{1,3})$/u, nullable: true, default: null }, // null: Downtown
  x: { type: 'num', min: -20000, max: 20000, nullable: true, default: null },       // where she stands
  y: { type: 'num', min: -200, max: 2000, nullable: true, default: null },          // (city-map.js units)
  face: { type: 'int', choices: [-1, 1], default: 1 },                              // left or right
};

// erinne HouseHere.
const HERE_FORM = {
  host: { type: 'str', pattern: UID_RE, nullable: true, default: null },            // whose home (null: her own)
  home: { type: 'str', choices: ['flat', 'house'], default: 'flat' },               // which home
  room: { type: 'str', choices: lumihouse.ROOMS },                                  // kitchen, bedroom, den
  x: { type: 'num', min: 0, max: 1000 },                                            // room-ui.js units
  y: { type: 'num', min: 0, max: 500 },
  face: { type: 'int', choices: [-1, 1], default: 1 },                              // left or right
};

const tenth = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10); // a tenth of a unit is plenty

/** Add the town and homes routes (index.js calls this once). */
function register(router) {
  router.post('/api/lumi-pet/town', (ctx) => {                                      // erinne pet_town
    const body = form(ctx.body, TOWN_FORM);                                         // checked
    const me = ctx.user.id;                                                         // Discord id
    const seen = save.townSeen(me);                                                 // "Show me in town"
    const x = tenth(body.x), y = tenth(body.y);                                     // rounded
    let change;                                                                     // moved / walk / null
    if (seen) change = TOWN.visit(me, body.at, body.district, body.inside, x, y, body.face); // recorded
    else change = TOWN.leave(me) ? 'moved' : null;                                  // hidden: forgotten at once
    const where = lumitown.place(body.at, body.district, body.inside);              // (a hidden Lumi still hears)
    if (change === 'moved') publish('moved');                                       // everyone looks again
    else if (change === 'walk') publish('walk', { place: where, district: body.district, uid: me, x, y, face: body.face }); // a step
    const here = [];                                                                // who she can see
    for (const p of TOWN.here(me, where)) {
      const person = lumipet._person(p.id);                                         // still known?
      if (!person) continue;                                                        // a stranger isn't drawn
      here.push({ ...p, name: person.username, look: lumitown.lookOf(p.id) });      // with name + look
    }
    return { seen, here, place: where, lines: TOWN.recent(where), phrases: lumitown.phrases(), emotes: lumitown.emotes(), you: me }; // erinne's answer
  });

  router.post('/api/lumi-pet/town/say', (ctx) => {                                  // erinne pet_town_say
    const body = form(ctx.body, {
      text: { type: 'str', max: 1000, nullable: true, default: null },              // typed words
      phrase: { type: 'str', pattern: /^[a-z][a-z-]{0,23}$/u, nullable: true, default: null }, // or a phrase id
    });
    const me = ctx.user.id;                                                         // Discord id
    const where = whereNow(me);                                                     // where she is
    if (!atHome(where) && !save.townSeen(me)) throw conflict("Turn on Show me in town first, so everyone can see who's talking."); // hidden in town
    if (where === null) throw conflict('Step out into Lumi Town first!');           // nowhere
    let said;                                                                       // the line
    try {
      said = lumitown.line(me, ctx.user.name, save.look(me).name || 'Lumi', where, { text: body.text, phrase: body.phrase }); // cleaned
    } catch (error) {
      throw unprocessable(error.message);                                           // checked first: a refused line uses no breath
    }
    if (lumitown.count(`lumi-say:${me}`, lumitown.SAY_GAP) > 1 || lumitown.count(`lumi-say-burst:${me}`, lumitown.SAY_WINDOW) > lumitown.SAY_BURST) {
      throw tooMany("Slow down, I'm out of breath!");                               // too fast
    }
    TOWN.said(said);                                                                // remembered for newcomers
    publish('said', { line: said });                                                // everyone there hears it
    return { line: said };                                                          // her own line
  });

  router.post('/api/lumi-pet/town/emote', (ctx) => {                                // erinne pet_emote
    const body = form(ctx.body, { emote: { type: 'str', pattern: /^[a-z]{1,16}$/u } }); // checked
    if (!(body.emote in lumitown.EMOTES)) throw unprocessable("That isn't one of the emotes."); // known emotes
    const me = ctx.user.id;                                                         // Discord id
    const where = whereNow(me);                                                     // where she is
    if (!atHome(where) && !save.townSeen(me)) throw conflict('Turn on Show me in town first, so everyone can see you.'); // hidden
    if (where === null) throw conflict('Step out into Lumi Town first!');           // nowhere
    if (lumitown.count(`lumi-emote:${me}`, lumitown.EMOTE_GAP) > 1) throw tooMany('One at a time!'); // one a second
    publish('emote', { place: where, uid: me, emote: body.emote });                 // everyone there sees it
    return { emote: body.emote, place: where };                                     // done
  });

  router.get('/api/lumi-pet/town/stream', (ctx) => {                                // erinne pet_town_stream
    const me = ctx.user.id;                                                         // Discord id
    let mine = null;                                                                // where she was lately (for walks)
    let mineAt = -1;                                                                // when we last looked (s)
    events.sse(ctx, CHANNEL, {
      filter: (event, data) => {                                                    // erinne _relay, per viewer
        const d = data && typeof data === 'object' ? data : {};                     // the event's data
        const kind = d.kind || event;                                               // its kind
        if (kind === 'walk' && lumihouse.monotonic() - mineAt >= 1.0) {             // walks come thick and fast
          mine = whereNow(me); mineAt = lumihouse.monotonic();                      // her place, once a second
        }
        return relay(kind, d, me, mine);                                            // [event, data] or null
      },
    });                                                                             // the stream answers itself
  });

  router.get('/api/lumi-pet/houses', (ctx) => {                                     // erinne pet_houses
    const me = ctx.user.id;                                                         // Discord id
    const flats = [];                                                               // homes she may visit
    for (const row of getDb().prepare('SELECT user_id FROM lumi_pets ORDER BY user_id LIMIT 500').all()) {
      const uid = String(row.user_id);                                              // their id
      if (uid === me) continue;                                                     // never her own
      const { door, blocked } = save.door(uid);                                     // their front door
      const person = lumipet._person(uid);                                          // still known?
      if (!person || lumihouse.access(door, blocked, uid, me, HOUSES) === 'closed') continue; // closed or blocked: not listed
      flats.push({
        id: uid, name: person.username, lumi: save.look(uid).name, door,            // who
        home: HOUSES.home(uid), visitors: HOUSES.inside(uid, uid).length,           // in? guests?
        apt: lumicity.apartment(uid), town: lumicity.homeTown(uid),                 // which Lumi Heights, which door
      });
    }
    flats.sort((a, b) => (a.home === b.home ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : a.home ? -1 : 1)); // at home first, then by name
    return { flats: flats.slice(0, 50), me: { apt: lumicity.apartment(me), town: lumicity.homeTown(me) } }; // the list
  });

  router.post('/api/lumi-pet/houses/here', (ctx) => {                               // erinne pet_house_here
    const body = form(ctx.body, HERE_FORM);                                         // checked
    const me = ctx.user.id;                                                         // Discord id
    const host = body.host || me;                                                   // whose home
    const insideHost = [lumihouse.place(host, '', 'flat'), lumihouse.place(host, '', 'house')]; // "house:<host>:", "home:<host>:"
    const inHost = (where) => Boolean(where) && insideHost.some((p) => where.startsWith(p)); // in either of the host's homes?
    if (host !== me) {
      if (!lumipet._person(host)) throw notFound("There's no flat there.");        // a stranger
      const { door, blocked } = save.door(host);                                    // their door
      if (lumihouse.access(door, blocked, host, me, HOUSES) !== 'in') {             // may no longer be in
        if (inHost(HOUSES.where(me))) { HOUSES.leave(me); publish('moved'); }       // out she goes
        throw forbidden('Time to go home!');                                        // the page walks her home
      }
    }
    if (body.home === 'house' && lumicity.plotOf(host) === null) throw notFound('No house there yet.'); // no land, no house
    const where = lumihouse.place(host, body.room, body.home);                      // this room
    const x = tenth(body.x), y = tenth(body.y);                                     // rounded
    const was = HOUSES.where(me);                                                   // where she was
    let paid = 0;                                                                   // a house-warming gift
    let owed = 0;                                                                   // ...or owed
    if (host !== me && !inHost(was)) {                                              // just arrived at a friend's
      tx(() => {                                                                    // ref + coins together
        const day = dayKey();                                                       // the LA day
        const ref = `lumi-housewarm:${me}:${host}:${day}`;                          // once a day per home
        const today = getDb().prepare('SELECT COUNT(*) AS n FROM lumi_coin_refs WHERE ref LIKE ? AND ref <> ?').get(`lumi-housewarm:${me}:%:${day}`, ref).n; // other homes today
        if (today >= HOUSEWARM_PER_DAY) return;                                     // three homes' worth already
        const r = sgc.pay(me, ctx.user.name, HOUSEWARMING, 'pet', 'housewarm', ref); // bank -> player (pay-once)
        paid = r.paid; owed = r.owed;                                               // what happened
      });
    }
    if (HOUSES.visit(me, host, body.room, x, y, body.face, body.home)) publish('moved'); // arrived or another room
    else publish('walk', { place: where, uid: me, x, y, face: body.face });         // a step
    const people = [];                                                              // who else is here
    for (const p of HOUSES.inside(host, me, body.home)) {
      const person = lumipet._person(p.id);                                         // still known?
      if (person) people.push({ ...p, name: person.username, look: save.look(p.id), host: p.id === host }); // with name + look
    }
    const knocks = [];                                                              // knocks at her own door
    if (host === me) {
      for (const k of HOUSES.waiting(me)) {
        const guest = lumipet._person(k.guest);                                     // who knocked
        if (guest) knocks.push({ id: k.id, guest: k.guest, name: guest.username, lumi: save.look(k.guest).name }); // for the page
      }
    }
    return {
      here: people, place: where, lines: TOWN.recent(where), phrases: lumitown.phrases(), emotes: lumitown.emotes(), you: me, // the room
      home: HOUSES.home(host, body.home), knocks, paid, owed, coins: paid || owed ? sgc.balance(me) : null, // gift (SGC)
    };
  });                                                                               // (the gift is pay-once by ref, inside its own tx)

  router.get('/api/lumi-pet/houses/:host', (ctx) => {                               // erinne pet_house
    const host = hostParam(ctx);                                                    // whose
    const home = ctx.query.home === undefined ? 'flat' : ctx.query.home;            // which home
    if (!lumihouse.HOMES.includes(home)) throw new LumiError(422, 'invalid', 'home is flat or house.'); // Literal
    const person = lumipet._person(host);                                           // known?
    if (!person) throw notFound("There's no flat there.");                         // a stranger
    const plot = home === 'house' ? lumicity.plotOf(host) : null;                   // their land
    if (home === 'house' && plot === null) throw notFound('No house there yet.');   // no land, no house
    const { door, blocked } = save.door(host);                                      // their door
    const way = lumihouse.access(door, blocked, host, ctx.user.id, HOUSES);         // may she come in?
    if (way === 'closed') throw forbidden('That door is closed.');                  // closed or blocked
    const seen = { id: host, name: person.username, door, access: way, home: HOUSES.home(host), apt: lumicity.apartment(host), town: lumicity.homeTown(host) }; // whose
    if (home === 'house') seen.plot = plot;                                         // which plot
    if (way === 'own' || way === 'in') return { ...seen, ...lumipet.houseView(host, home) }; // inside
    return { ...seen, look: save.look(host) };                                      // only the doorstep
  });

  router.post('/api/lumi-pet/houses/:host/knock', (ctx) => {                        // erinne pet_knock
    const host = hostParam(ctx);                                                    // whose door
    const me = ctx.user.id;                                                         // Discord id
    if (!lumipet._person(host)) throw notFound("There's no flat there.");          // a stranger
    const { door, blocked } = save.door(host);                                      // their door
    const way = lumihouse.access(door, blocked, host, me, HOUSES);                  // may she?
    if (way === 'closed') throw forbidden('That door is closed.');                  // closed or blocked
    if (way === 'own' || way === 'in') return { in: true };                         // just walk in
    if (!HOUSES.home(host)) throw conflict("Nobody's in. Try again later!");        // nobody to answer
    if (lumitown.count(`lumi-knock:${me}`, 10) > 3) throw tooMany('Give them a moment to come to the door!'); // not a drum roll
    let knock;                                                                      // the knock
    try {
      knock = HOUSES.knock(me, host);                                               // knock knock
    } catch (error) {
      throw new LumiError(503, 'busy_town', error.message);                         // too many knocks at once
    }
    publish('knock', { host });                                                     // the host hears it
    return { in: false, knock: knock.id };                                          // wait for an answer
  });

  router.get('/api/lumi-pet/knocks/:id', (ctx) => {                                 // erinne pet_knock_state
    const knock = HOUSES.knockOf(String(ctx.params.id || '').slice(0, 40));         // the knock
    if (!knock || knock.guest !== ctx.user.id) return { answer: null, gone: true };  // forgotten (or not hers)
    return { answer: knock.answer, gone: false };                                   // waiting or answered
  });

  router.post('/api/lumi-pet/knocks/:id/answer', (ctx) => {                         // erinne pet_knock_answer
    const body = form(ctx.body, { yes: { type: 'bool' } });                         // let in?
    let knock;                                                                      // the knock
    try {
      knock = HOUSES.answer(String(ctx.params.id || '').slice(0, 40), ctx.user.id, body.yes); // only the host may
    } catch (error) {
      if (error.code === 'gone') throw notFound(error.message);                     // gone
      throw error;                                                                  // a bug
    }
    publish('answer', { guest: knock.guest, host: ctx.user.id, yes: body.yes });    // the knocker hears it
    return { answer: body.yes };                                                    // done
  });

  router.post('/api/lumi-pet/houses/:host/guestbook', (ctx) => {                    // erinne pet_sign
    const host = hostParam(ctx);                                                    // whose book
    const body = form(ctx.body, { text: { type: 'str', max: 1000 } });              // the line
    const me = ctx.user.id;                                                         // Discord id
    if (host === me) throw conflict("That's your own guestbook! Friends sign it when they visit."); // not her own
    if (!lumipet._person(host)) throw notFound("There's no flat there.");          // a stranger
    const { door, blocked } = save.door(host);                                      // their door
    if (lumihouse.access(door, blocked, host, me, HOUSES) !== 'in') throw forbidden('Come in first, then sign!'); // only a guest who's in
    let text;                                                                       // cleaned words
    try { text = lumitown.clean(body.text); } catch (error) { throw unprocessable(error.message); } // like chat
    if (lumitown.count(`lumi-sign:${me}:${host}`, SIGN_GAP) > 1) throw tooMany("You've signed already! Come back another time."); // once in a while
    const book = tx(() => {                                                         // one write
      try {
        return lumipet.sign(host, me, ctx.user.name, save.look(me).name, text);    // into the host's save
      } catch (error) {
        if (error instanceof lumipet.PetError) throw notFound(error.message);       // no Lumi there
        throw error;                                                                // a bug
      }
    });
    publish('guestbook', { host });                                                 // the host's page looks again
    return { guestbook: book.map((e) => ({ id: e.id, name: e.name, lumi: e.lumi, text: e.text, at: e.at })) }; // never the uid
  });
}

module.exports = { register, relay, whereNow, HOUSEWARMING, HOUSEWARM_PER_DAY, SIGN_GAP };

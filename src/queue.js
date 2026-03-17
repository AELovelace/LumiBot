/**
 * Per-guild in-memory track queue.
 *
 * Track shape:
 *   {
 *     type:        'youtube' | 'soundcloud' | 'http' | 'search',
 *     url:         string | null,   // set for youtube / soundcloud / http
 *     query:       string | null,   // set for search
 *     title:       string,
 *     requestedBy: string,          // Discord user tag
 *   }
 */

/** @type {Map<string, Array<object>>} */
const queues = new Map();

/**
 * Add a track to the end of a guild's queue.
 * @returns {number} The new queue length (position of the added track).
 */
function enqueue(guildId, track) {
  if (!queues.has(guildId)) {
    queues.set(guildId, []);
  }

  const q = queues.get(guildId);
  q.push(track);
  return q.length;
}

/**
 * Remove and return the next track from the front of the queue.
 * Returns null if the queue is empty or doesn't exist.
 */
function dequeue(guildId) {
  const q = queues.get(guildId);
  if (!q || q.length === 0) {
    return null;
  }

  const track = q.shift();
  if (q.length === 0) {
    queues.delete(guildId);
  }

  return track;
}

/**
 * Return the next track without removing it, or null if empty.
 */
function peekQueue(guildId) {
  const q = queues.get(guildId);
  return q?.[0] ?? null;
}

/**
 * Return a copy of all queued tracks for a guild (empty array if none).
 */
function getQueue(guildId) {
  return [...(queues.get(guildId) ?? [])];
}

/**
 * Return how many tracks are currently queued for a guild.
 */
function getQueueLength(guildId) {
  return queues.get(guildId)?.length ?? 0;
}

/**
 * Discard all queued tracks for a guild.
 */
function clearQueue(guildId) {
  queues.delete(guildId);
}

module.exports = {
  clearQueue,
  dequeue,
  enqueue,
  getQueue,
  getQueueLength,
  peekQueue,
};

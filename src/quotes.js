const fs = require('fs');
const path = require('path');

const QUOTES_FILE = path.join(__dirname, '..', 'data', 'quotes.json');
const JACKHANDEY_FILE = path.join(__dirname, '..', 'data', 'jackhandey.json');

function loadQuotes() {
  try {
    if (!fs.existsSync(QUOTES_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(QUOTES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQuotes(quotes) {
  const dir = path.dirname(QUOTES_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(QUOTES_FILE, JSON.stringify(quotes, null, 2), 'utf8');
}

function getRandomQuote() {
  const quotes = loadQuotes();
  if (quotes.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * quotes.length);
  return { text: quotes[index], number: index + 1, total: quotes.length };
}

function addQuote(text) {
  const quotes = loadQuotes();
  quotes.push(text);
  saveQuotes(quotes);
  return { number: quotes.length, total: quotes.length };
}

function getRandomJackHandey() {
  try {
    const raw = fs.readFileSync(JACKHANDEY_FILE, 'utf8');
    const data = JSON.parse(raw);
    const quotes = Array.isArray(data.quotes) ? data.quotes : [];
    if (quotes.length === 0) return null;
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    return { quote, attribution: data.attribution };
  } catch {
    return null;
  }
}

module.exports = { getRandomQuote, addQuote, getRandomJackHandey };

const { logger } = require('./logger');

/**
 * Polls a plain-text URL on a fixed interval and calls `onSongChange(newContent)`
 * whenever the content differs from the last observed value.
 *
 * The first successful fetch establishes the baseline and does NOT fire the
 * callback, so the channel is not spammed when the bot joins.
 *
 * Returns a controller object with a `stop()` method.
 */
function createSongWatcher({ url, intervalMs, onSongChange }) {
  let lastContent = null;
  let timer = null;
  let stopped = false;

  async function poll() {
    if (stopped) {
      return;
    }

    let text;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        logger.warn(`Song watcher: HTTP ${response.status} from ${url}`);
        return;
      }

      text = (await response.text()).trim();
    } catch (error) {
      logger.warn(`Song watcher: fetch failed. ${error.message}`);
      return;
    }

    if (!text) {
      return;
    }

    if (lastContent === null) {
      // First successful fetch — set baseline silently.
      lastContent = text;
      logger.debug(`Song watcher: baseline established → "${text}"`);
      return;
    }

    if (text !== lastContent) {
      logger.info(`Song watcher: song changed → "${text}"`);
      lastContent = text;
      try {
        await onSongChange(text);
      } catch (error) {
        logger.warn(`Song watcher: onSongChange callback threw. ${error.message}`);
      }
    }
  }

  function scheduleNext() {
    if (stopped) {
      return;
    }

    timer = setTimeout(async () => {
      await poll();
      scheduleNext();
    }, intervalMs);

    timer.unref?.();
  }

  // Run an immediate first poll to set the baseline, then begin the interval.
  void poll().then(() => {
    scheduleNext();
  });

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

module.exports = { createSongWatcher };

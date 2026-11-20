/* Prism Drop's measurements, for drawing the field. The rules themselves live on the server (mnemerynne/prism.py), which
   rolls every drop, because a finished game pays coins and a browser could claim any score. */
(function (root) {
  "use strict";
  root.PrismRules = { WIDTH: 10, HEIGHT: 20, DROPS: 10,     // ten pins across, twenty rows, ten drops a game
                      PLATFORM_SPAN: 3, PLATFORM_BOUNCES: 2 };   // columns wide, and bounces each gives per drop
})(self);

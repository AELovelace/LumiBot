// Build entry for Lumi-Town's Discord Activity page (npm run build:activity-sdk).
// esbuild bundles Discord's Embedded App SDK (pinned in package.json devDependencies) into ONE self-contained file,
// public/lumi/vendor/discord-embedded-app-sdk.js, exposing window.DiscordEmbedded. Serving it from /lumipet/static
// keeps Lumi's CSP at script-src 'self' (no CDN). The built file is committed, so production needs no build step.
export { DiscordSDK, patchUrlMappings } from "@discord/embedded-app-sdk";

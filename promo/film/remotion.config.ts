import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(94);
Config.setCodec("h264");
Config.setCrf(16);
Config.setPixelFormat("yuv420p");
// Use a local Chromium when one is given (no download): REMOTION_BROWSER=/path/to/chrome-headless-shell
if (process.env.REMOTION_BROWSER) Config.setBrowserExecutable(process.env.REMOTION_BROWSER);

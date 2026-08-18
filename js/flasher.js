"use strict";

/*
 * Compatibility entry point for the OpenMCC desktop flasher.
 * The maintained implementation lives in flasher-v2.js.
 */

import("./flasher-v2.js").catch(error => {
    console.error("OpenMCC ESP32 flasher failed to load", error);
});

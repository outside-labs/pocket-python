import {runTokenRequest} from "./source-token-request.mjs";
self.onmessage = event => self.postMessage(runTokenRequest(event.data));

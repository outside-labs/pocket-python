import {runSourceRequest} from "./source-request.mjs";
self.onmessage = async event => self.postMessage(await runSourceRequest(event.data));

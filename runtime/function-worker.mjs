import {runFunctionRequest} from "./function-request.mjs";
self.onmessage = event => self.postMessage(runFunctionRequest(event.data));

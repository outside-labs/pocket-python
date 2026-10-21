import {runModuleRequest} from "./module-request.mjs";
self.onmessage = async event => self.postMessage(await runModuleRequest(event.data));

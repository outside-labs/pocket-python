import {runCallbackRequest} from './callback-request.mjs';
self.onmessage = async event => self.postMessage({id: event.data.id, ...await runCallbackRequest(event.data)});

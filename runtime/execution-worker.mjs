import {runExecutionRequest} from './execution_checks.mjs';
self.onmessage = async event => self.postMessage(await runExecutionRequest(event.data));

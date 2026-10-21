import {runLibraryProfileRequest} from "./library-profile-request.mjs";
self.onmessage = async event => self.postMessage(await runLibraryProfileRequest(event.data));

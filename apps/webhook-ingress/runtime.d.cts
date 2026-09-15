/** Type surface for the generated build:ingress artifact. No runtime implementation here. */
declare const runtime:{handle:(request:Request)=>Promise<Response>};
export = runtime;

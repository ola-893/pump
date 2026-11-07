export type RetainedAsset = {file:string;bytes:number;sha256:string};
export function copyAssets(source:string,destination:string):void;
export function assetManifest(directory:string):{version:number;assets:RetainedAsset[]};
export function retainPublishedAssets(origin:string,destination:string,fetcher?:typeof fetch):Promise<void>;

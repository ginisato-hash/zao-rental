import type {Direction} from './recommendation';
export const AVATAR_VISUALIZATION_FEATURE=false as const;
export const AVATAR_TYPES=['APPEARANCE_1','APPEARANCE_2'] as const;
export type AvatarType=typeof AVATAR_TYPES[number];
export type VisualLayer='AVATAR'|'SKI'|'BOOT'|'JACKET'|'PANTS';
export type VisualMatch='EXACT_PROMISE'|'GENERIC_REFERENCE';
// Explicit purpose-specific permission in an existing immutable ContentRevision.
// A model photo's general rightsConfirmed flag alone never supplies this permission.
export type AvatarVisualUse={purpose:'AVATAR_VISUALIZATION_V1';visualId:string;layer:VisualLayer;avatarType:AvatarType|null;match:VisualMatch;modelId:string|null;variantId:string|null;season:string|null;skiLengthCm:number|null;mediaId:string;derivativeSha256:string};
export type VisualRef={id:string;layer:VisualLayer;match:VisualMatch;derivativeSha256:string;revisionId:string;releaseId:string;anchor:{x:number;y:number};position:{x:number;y:number}};
// Server-owned metadata, never a browser authorization input or a signed/public URL.
export type VisualMetadata={id:string;layer:VisualLayer;avatarType:AvatarType|null;match:VisualMatch;modelId:string|null;variantId:string|null;season:string|null;skiLengthCm:number|null;mediaId:string;derivativeSha256:string;revisionId:string;releaseId:string;state:'ACTIVE'|'DISABLED';sortOrder:number;anchor:{x:number;y:number};position:{x:number;y:number};rightsEligible:boolean;rightsUntil:string|null};
export type SkiVisualization={skiLengthCm:number;skiToBodyRatio:number;visual:VisualRef|null;fallback:VisualMatch|null};
export type AvatarVisualizationV1={version:1;avatarType?:AvatarType;customerHeightCm?:number;avatar:VisualRef|null;candidates:Record<Direction,SkiVisualization|null>;boot:VisualRef|null;jacket:VisualRef|null;pants:VisualRef|null;disclaimer:string};

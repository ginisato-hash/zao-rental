import type {Direction} from '../../../contracts/src/recommendation';
import type {AvatarVisualizationV1,VisualRef,VisualLayer} from '../../../contracts/src/avatar-visualization';
// Shared normalized-artboard contract. No browser, IO, sizing or business service.
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const normalized=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function valid(v:VisualRef|null|undefined,layer:VisualLayer):v is VisualRef{
 return !!v&&v.layer===layer&&uuid.test(v.id)&&/^[a-f0-9]{64}$/.test(v.derivativeSha256)&&['GENERIC_REFERENCE','EXACT_PROMISE'].includes(v.match)&&!!v.anchor&&!!v.position&&[v.anchor.x,v.anchor.y,v.position.x,v.position.y].every(normalized)
  &&(!['AVATAR','SKI'].includes(layer)||v.anchor.y===v.position.y);
}
export type AvatarLayerBox={visual:VisualRef;x:number;y:number;width:number;height:number;src:string};
export function avatarLayout(value:AvatarVisualizationV1|null|undefined,direction:Direction){
 if(!value||value.version!==1||!value.candidates||!['RECOMMENDED','SHORTER','LONGER'].includes(direction))return null;
 const selected=value.candidates[direction];
 const ratio=selected&&positive(value.customerHeightCm)&&positive(selected.skiLengthCm)&&positive(selected.skiToBodyRatio)&&Math.abs(selected.skiToBodyRatio-selected.skiLengthCm/value.customerHeightCm)<1e-10?selected.skiToBodyRatio:null;
 // Nonpositive/malformed scale is unavailable, never cosmetically corrected.
 if(value.customerHeightCm!==undefined&&!positive(value.customerHeightCm)||selected&&!ratio)return null;
 const body=valid(value.avatar,'AVATAR')?value.avatar:null,boxes:AvatarLayerBox[]=[];
 const bodyX=body?(body.position.x-body.anchor.x)*400:0;
 const add=(visual:VisualRef,x:number,y:number,width:number,height:number)=>boxes.push({visual,x,y,width,height,src:'/avatar-media/'+visual.id+'/'+visual.derivativeSha256});
 if(body)add(body,bodyX,0,400,1000);
 for(const [layer,v]of [['PANTS',value.pants],['JACKET',value.jacket],['BOOT',value.boot]] as const){if(valid(v,layer))add(v,bodyX+(v.position.x-v.anchor.x)*400,(v.position.y-v.anchor.y)*1000,400,1000);}
 const ski=selected&&ratio&&valid(selected.visual,'SKI')?selected.visual:null;
 if(ski&&ratio){const w=ratio*80,h=ratio*1000;add(ski,bodyX+400+120+w+(ski.position.x-ski.anchor.x)*w,1000-h,w,h);}
 if(!boxes.length)return null;
 const minX=Math.min(0,...boxes.map(b=>b.x)),maxX=Math.max(400,...boxes.map(b=>b.x+b.width));
 const minY=Math.min(0,...boxes.map(b=>b.y)),maxY=Math.max(1000,...boxes.map(b=>b.y+b.height));
 const width=maxX-minX+80,height=maxY-minY+80;
 if(!positive(width)||!positive(height)||!positive(width/height))return null;
 return {width,height,floor:(1040-minY)/height*100,boxes:boxes.map(b=>({...b,x:(b.x-minX+40)/width*100,y:(b.y-minY+40)/height*100,width:b.width/width*100,height:b.height/height*100})),skiLengthCm:ratio?selected!.skiLengthCm:null,customerHeightCm:positive(value.customerHeightCm)?value.customerHeightCm:null};
}

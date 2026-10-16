import type {Locator,Page} from '@playwright/test';
/** Wait for actual bundled SVG image bytes, not a vacuous HTML-img selector. */
export async function decodeReference(root:Page|Locator){
 await root.locator('[data-avatar-stage]').evaluateAll(async stages=>{
  const images=stages.flatMap(stage=>Array.from(stage.querySelectorAll('image')));
  if(!images.length)throw new Error('REFERENCE_IMAGES_MISSING');
  await Promise.all(images.map(async element=>{const image=new Image();image.src=element.getAttribute('href')!;await image.decode();}));
 });
}

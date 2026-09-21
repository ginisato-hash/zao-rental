export const STOCK_IMPORT_HEADER_V2=['source_kind','intent','model_id','season','variant_id','manufacturer_sku','quantity','unit','asset_ids','store_id','source_document','source_row','category','size','tier','bsl_mm','status'];
// V3 adds the manufacturer/model names the receipt already carries and one optional
// internal equipment note. V2 stays accepted; neither new column is ever guessed.
export const STOCK_IMPORT_HEADER_V3=[...STOCK_IMPORT_HEADER_V2,'manufacturer','model_name','note'];

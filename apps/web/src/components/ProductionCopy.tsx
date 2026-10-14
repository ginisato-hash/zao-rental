'use client';
import {createContext,useContext,type ReactNode} from 'react';
// Presentation only. Only the isolated fixture app supplies this provider; it cannot
// enable checkout, publication, mail delivery or any other runtime capability.
const ProductionCopyContext=createContext(false);
export function ProductionCopyProvider({children}:{children:ReactNode}){return <ProductionCopyContext.Provider value={true}>{children}</ProductionCopyContext.Provider>;}
export const useProductionCopy=()=>useContext(ProductionCopyContext);
export function DevelopmentNotice({children}:{children:ReactNode}){return useProductionCopy()?null:<>{children}</>;}

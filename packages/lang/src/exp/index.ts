import {
	All,
	App,
	Atom,
	Bottom,
	Dict,
	EDict,
	EFn,
	Enum,
	ETyFn,
	EVec,
	Fn,
	isEqual,
	isSame,
	isSubtype,
	Log,
	Node,
	NodeWithLog,
	Num,
	Obj,
	print,
	Prod,
	Scope,
	Str,
	Sym,
	TyAtom,
	TyDict,
	TyEnum,
	TyFn,
	tyNum,
	TyProd,
	tyStr,
	TyUnion,
	TyValue,
	TyVar,
	TyVec,
	Unit,
	Value,
	ValueWithLog,
	Vec,
} from './exp'

export {Node, Value}

export {Log, ValueWithLog, NodeWithLog}

export {Obj}

export const obj = Obj.of

// Exp
export {Sym, App, Scope, EFn, ETyFn, EVec, EDict}

export const sym = Sym.of
export const app = App.of
export const scope = Scope.of
export const eFn = EFn.of
export const eTyFn = ETyFn.of
export const eVec = EVec.of
export const eVecFrom = EVec.from
export const eDict = EDict.of
export const eDictFrom = EDict.from

// Value
export {
	All,
	Bottom,
	Unit,
	Num,
	Str,
	Atom,
	TyAtom,
	TyVar,
	Enum,
	TyEnum,
	Fn,
	TyFn,
	Vec,
	TyVec,
	Dict,
	TyDict,
	Prod,
	TyProd,
	TyValue,
	TyUnion,
}

const tyBool = TyEnum.of('Bool', ['true', 'false'])
const True = tyBool.getEnum('true')
const False = tyBool.getEnum('false')

export {tyNum, tyStr, tyBool, True, False}

export const all = All.of
export const bottom = Bottom.of
export const unit = Unit.of
export const num = Num.of
export const str = Str.of
export const bool = (value: boolean) => (value ? True : False)
export const tyAtom = TyAtom.of
export const tyEnum = TyEnum.of
export const tyFn = TyFn.of
export const tyVar = TyVar.of
export const dict = Dict.of
export const tyDict = TyDict.of
export const vec = Vec.of

export {isSame, isEqual, isSubtype, print}

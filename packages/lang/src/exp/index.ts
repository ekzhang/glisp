import {isEqualWith} from 'lodash'

import {hasEqualValues} from '../utils/hasEqualValues'
import {nullishEqual} from '../utils/nullishEqual'
import {zip} from '../utils/zip'
import {
	All,
	App,
	Bottom,
	Dict,
	Fn,
	Log,
	Node,
	NodeWithLog,
	Num,
	Obj,
	Scope,
	Str,
	Sym,
	TyFn,
	Type,
	TyVar,
	Unit,
	ValueWithLog,
	Vec,
} from './exp'

export {Node}

export {Sym, Obj, Fn, TyFn, Vec, App, Scope}

export {Type, Log, ValueWithLog, NodeWithLog}

// Shorthands
export const sym = Sym.of
export const obj = Obj.of
export const all = All.of
export const bottom = Bottom.of
export const unit = Unit.of
export const num = Num.of
export const str = Str.of
export const tyVar = TyVar.of
export const fn = Fn.of
export const tyFn = TyFn.of
export const vec = Vec.of
export const dict = Dict.of
export const dictFrom = Dict.from
export const vecFrom = Vec.from
export const app = App.of
export const scope = Scope.of

export function isEqual(a: Node, b: Node): boolean {
	switch (a.type) {
		case 'sym':
		case 'tyVar':
			return b.type === a.type && a.name === b.name
		case 'obj':
			return b.type === a.type && a.value.isEqualTo(b.value)
		case 'all':
		case 'bottom':
		case 'unit':
			return b.type === a.type
		case 'num':
		case 'str':
			return b.type === a.type && a.value === b.value
		case 'vec':
			return (
				b.type === 'vec' &&
				a.length === b.length &&
				nullishEqual(a.rest, b.rest, isEqual) &&
				zip(a.items, b.items).every(([ai, bi]) => isEqual(ai, bi))
			)
		case 'dict':
			return (
				b.type === 'dict' &&
				hasEqualValues(
					a.items,
					b.items,
					(a, b) => !!a.optional === !!b.optional && isEqual(a.value, b.value)
				)
			)
		case 'fn':
			return (
				b.type === 'fn' &&
				hasEqualValues(a.param, b.param, isEqual) &&
				isEqual(a.body, b.body)
			)
		case 'tyFn': {
			return (
				b.type === 'tyFn' &&
				a.tyParam.length === b.tyParam.length &&
				zip(a.tyParam, b.tyParam).every(([ap, bp]) => isEqual(ap, bp)) &&
				isEqual(a.out, b.out)
			)
		}
		case 'app':
			return b.type === 'app' && isEqualWith(a.args, b.args, isEqual)
		case 'scope': {
			return (
				b.type === 'scope' &&
				nullishEqual(a.out, b.out, isEqual) &&
				hasEqualValues(a.vars, b.vars, isEqual)
			)
		}
	}
}

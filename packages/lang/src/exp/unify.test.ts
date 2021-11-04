import _ from 'lodash'

import * as Val from '../val'
import {applySubst, Const, getTyVars, resolveLowerConsts, Subst} from './unify'

describe('applySubst', () => {
	const T = Val.tyVar()
	const U = Val.tyVar()

	run(T, [T, Val.tyInt], Val.tyInt)
	run(T, [T, U], U)
	run(Val.tyFn([T], T), [T, Val.tyInt], Val.tyFn([Val.tyInt], Val.tyInt))
	run(Val.tyFn([T], Val.tyFn([T], T)), [T, U], Val.tyFn([U], Val.tyFn([U], U)))

	function run(val: Val.Value, subst: Subst, expected: Val.Value) {
		test(printSubsts(subst) + val.print() + ' := ' + expected.print(), () => {
			const substituted = applySubst(val, subst)

			if (!substituted.isEqualTo(expected)) {
				fail(`Got=${substituted}`)
			}
		})
	}

	function printSubsts(...substs: Subst[]) {
		const strs = substs.map(([s, t]) => s.print() + ' |-> ' + t.print())
		return '[' + strs.join(', ') + ']'
	}
})

describe('getTyVars', () => {
	const T = Val.tyVar(),
		U = Val.tyVar()

	run(Val.int(1), [])
	run(Val.bool(true), [])
	run(T, [T])
	run(Val.uniteTy(T, U), [T, U])
	run(Val.tyFn([Val.tyBool, T, T], U), [T, U])

	function run(ty: Val.Value, expected: Val.TyVar[]) {
		const eStr = '{' + expected.map(e => e.print()).join(', ') + '}'

		test(`FV(${ty.print()}) equals to ${eStr}`, () => {
			const tvs = [...getTyVars(ty)]
			const diff = _.differenceWith(tvs, expected, Val.isEqual)

			if (diff.length > 0) {
				fail('Got={' + tvs.map(tv => tv.print()).join(', ') + '}')
			}
		})
	}
})

describe('resolveLowerConsts', () => {
	const T = Val.tyVar(),
		U = Val.tyVar()

	run(T, [[Val.tyInt, T]], Val.tyInt)
	run(
		T,
		[
			[Val.tyInt, U],
			[U, T],
		],
		Val.tyInt
	)

	function run(tv: Val.TyVar, consts: Const[], expected: Val.Value) {
		const tvStr = tv.print()
		const cStr = printConsts(consts)
		const eStr = expected.print()

		test(`${tvStr} in ${cStr} equals to ${eStr}`, () => {
			const resolved = resolveLowerConsts(tv, consts)
			if (!resolved.isEqualTo(expected)) {
				fail(`Got=${resolved.print()}`)
			}
		})
	}

	function printConsts(consts: Const[]) {
		const strs = consts.map(([a, b]) => a.print() + ' <: ' + b.print())
		return '{' + strs.join(', ') + '}'
	}
})

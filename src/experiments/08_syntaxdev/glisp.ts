import _ from 'lodash'
import peg from 'pegjs'

import ParserDefinition from './parser.pegjs'

const parser = peg.generate(ParserDefinition)

type ReservedKeywordNames = '=>' | 'let' | '...'

type Value =
	| ValuePrim
	| Value[]
	| ValueType
	| ValueFnType
	| ValueExp
	| ValueHashMap
	| ValueFn

type ValuePrim = boolean | number | string

type ValueType = ValueValType | ValueFnType

interface ValueValType {
	kind: 'valType'
	supertype: null | ValueType
}

interface ValueFnType {
	kind: 'fnType'
	params: ValueType | ValueType[]
	out: ValueType
}

interface ValueExp {
	kind: 'exp'
	exp: Exp
}

interface ValueFn {
	kind: 'fn'
	body: <A extends Exp, R extends Value>(
		this: {eval: typeof evalExp},
		...arg0: A[]
	) => R
}

interface ValueHashMap {
	kind: 'hashMap'
	value: {
		[key: string]: Value
	}
}

type Exp = ExpValue | ExpSymbol | ExpReservedKeyword | ExpColl

type NonNullable<T> = Exclude<T, undefined | null>

interface Log {
	level: 'error' | 'warn' | 'info'
	reason: string
}

type ExpColl = ExpList | ExpVector | ExpHashMap

interface ExpBase {
	parent: null | ExpColl
	logs?: Log[]
}

interface ExpValue extends ExpBase {
	ast: 'value'
	value: Value
}

interface ExpSymbol extends ExpBase {
	ast: 'symbol'
	name: string
	inspected?:
		| {semantic: 'ref'; ref: Exp}
		| {semantic: 'capture'}
		| {semantic: 'invalid'}
}

interface ExpReservedKeyword extends ExpBase {
	ast: 'reservedKeyword'
	name: ReservedKeywordNames
}

interface ExpList extends ExpBase {
	ast: 'list'
	items: Exp[]
	inspected?:
		| {semantic: 'application'; fn: Exp; params: Exp[]}
		| {semantic: 'invalid'}
}

interface ExpVector extends ExpBase {
	ast: 'vector'
	items: Exp[]
	inspected?:
		| {semantic: 'value'; value: Exp}
		| {semantic: 'vector'; items: Exp[]}
}

interface ExpHashMap extends ExpBase {
	ast: 'hashMap'
	items: Exp[]
	inspected?: {
		semantic: 'hashMap'
		hashMap: {
			[hash: string]: Exp
		}
	}
}

export function readStr(str: string): Exp {
	const exp = parser.parse(str) as Exp | undefined

	if (exp === undefined) {
		return {parent: null, ast: 'vector', items: []}
	} else {
		return exp
	}
}

const TypeAny: ValueType = {kind: 'valType', supertype: null}
const TypeNumber: ValueType = {kind: 'valType', supertype: TypeAny}
const TypeString: ValueType = {kind: 'valType', supertype: TypeAny}
const TypeBoolean: ValueType = {kind: 'valType', supertype: TypeAny}

const GlobalSymbols: {[name: string]: Exp} = {
	Any: {
		parent: null,
		ast: 'value',
		value: TypeAny,
	},
	Number: {
		parent: null,
		ast: 'value',
		value: TypeNumber,
	},
	String: {
		parent: null,
		ast: 'value',
		value: TypeString,
	},
	Boolean: {
		parent: null,
		ast: 'value',
		value: TypeBoolean,
	},
	PI: {
		parent: null,
		ast: 'value',
		value: Math.PI,
	},
	'+': {
		parent: null,
		ast: 'value',
		value: {
			kind: 'fn',
			body: function (this: {eval: typeof evalExp}, a: Exp, b: Exp) {
				return (this.eval(a) as number) + (this.eval(b) as number)
			} as any,
		},
	},
	':=>': {
		parent: null,
		ast: 'value',
		value: {
			kind: 'fn',
			body: function (this: {eval: typeof evalExp}, params: Exp, out: Exp) {
				const _params = this.eval(params) as ValueType[] | ValueType
				const _out = this.eval(out) as ValueType
				const ret = {
					kind: 'fnType',
					params: _params,
					out: _out,
				}
				console.log(ret)
				return ret
			} as any,
		},
	},
}

function pushLog(exp: Exp, log: Log) {
	if (exp.logs) {
		exp.logs.push(log)
	} else {
		exp.logs = [log]
	}
}

export function inspectAst(exp: ExpValue | ExpReservedKeyword): null
export function inspectAst(exp: ExpSymbol): NonNullable<ExpSymbol['inspected']>
export function inspectAst(exp: ExpList): NonNullable<ExpList['inspected']>
export function inspectAst(exp: ExpVector): NonNullable<ExpVector['inspected']>
export function inspectAst(
	exp: ExpHashMap
): NonNullable<ExpHashMap['inspected']>
export function inspectAst(
	exp: Exp
):
	| null
	| NonNullable<ExpSymbol['inspected']>
	| NonNullable<ExpList['inspected']>
	| NonNullable<ExpVector['inspected']>
	| NonNullable<ExpHashMap['inspected']> {
	switch (exp.ast) {
		case 'value':
		case 'reservedKeyword':
			return null
		case 'symbol':
			if (exp.inspected) return exp.inspected
			if (exp.name in GlobalSymbols) {
				return {
					semantic: 'ref',
					ref: GlobalSymbols[exp.name],
				}
			}
			// Not Defined
			pushLog(exp, {level: 'error', reason: `${exp.name} is not defined`})
			return {semantic: 'invalid'}

		case 'list':
			if (exp.inspected) return exp.inspected
			if (exp.items.length >= 1 && exp.items[0].ast === 'symbol') {
				return {
					semantic: 'application',
					fn: exp.items[0],
					params: exp.items.slice(1),
				}
			}
			return {semantic: 'invalid'}

		case 'vector':
			if (exp.inspected) return exp.inspected

			if (exp.items.length === 1) {
				return {semantic: 'value', value: exp.items[0]}
			} else {
				return {semantic: 'vector', items: exp.items}
			}

		case 'hashMap': {
			if (exp.inspected) return exp.inspected

			const hashMap: {[hash: string]: Exp} = {}

			if (exp.items.length % 2 !== 0) {
				pushLog(exp, {level: 'warn', reason: 'Odd number of hashMap items'})
			}

			for (let i = 0; i < exp.items.length; i += 2) {
				const key = exp.items[i]
				const value = exp.items[i + 1]
				if (key.ast !== 'value' || typeof key.value !== 'string') {
					pushLog(exp, {level: 'warn', reason: 'Key ... is not a string'})
					continue
				}
				hashMap[key.value] = value
			}

			return {semantic: 'hashMap', hashMap}
		}
	}
}

export function evalExp(exp: Exp): Value {
	switch (exp.ast) {
		case 'value':
			return exp.value

		case 'reservedKeyword':
			return {kind: 'exp', exp: exp}

		case 'symbol': {
			const inspected = inspectAst(exp)
			switch (inspected.semantic) {
				case 'ref':
					return evalExp(inspected.ref)
				case 'capture':
				case 'invalid':
					return []
			}
			break
		}

		case 'list':
			{
				const inspected = inspectAst(exp)
				switch (inspected.semantic) {
					case 'application': {
						switch (inspected.fn.ast) {
							case 'symbol': {
								const fn = evalExp(inspected.fn)

								if (
									typeof fn === 'object' &&
									!Array.isArray(fn) &&
									fn.kind === 'fn'
								) {
									return fn.body.call({eval: evalExp}, ...inspected.params)
								}
							}
						}
						return []
					}
					case 'invalid':
						return []
				}
			}
			break

		case 'vector': {
			const inspected = inspectAst(exp)
			switch (inspected.semantic) {
				case 'value':
					return evalExp(inspected.value)
				case 'vector':
					return inspected.items.map(evalExp)
			}
			break
		}

		case 'hashMap': {
			const inspected = inspectAst(exp)
			return {
				kind: 'hashMap',
				value: _.mapValues(inspected.hashMap, evalExp),
			}
		}
	}
}

export function printValue(val: Value): string {
	switch (typeof val) {
		case 'boolean':
			return val ? 'true' : 'false'
		case 'number':
			return val.toString()
		case 'string':
			return `"${val}"`
	}

	if (Array.isArray(val)) {
		return '[' + val.map(printValue).join(' ') + ']'
	}

	switch (val.kind) {
		case 'valType':
			switch (val) {
				case TypeAny:
					return 'Any'
				case TypeBoolean:
					return 'Boolean'
				case TypeNumber:
					return 'Number'
				case TypeString:
					return 'String'
				default:
					throw new Error('aaa')
			}
		case 'fnType':
			return '(:=> ' + printValue(val.params) + ' ' + printValue(val.out) + ')'
		case 'exp':
		case 'fn':
			throw new Error('aaa')
		case 'hashMap':
			return (
				'{' +
				Object.entries(val.value)
					.flatMap(([k, v]) => [`"${k}"`, printValue(v)])
					.join(' ') +
				'}'
			)
	}
}

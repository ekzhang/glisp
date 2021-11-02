import {entries, isEqualWith, values} from 'lodash'

import {bindWithLog, mapWithLog, WithLog, withLog} from '../utils/WithLog'
import * as Val from '../val'

export type Node = Sym | Int | Bool | Obj | Fn | Call | Scope

export type Type = Node['type']

interface Log {
	level: 'error' | 'warn' | 'info'
	reason: string
	ref: Node
}

export type ValueWithLog = WithLog<Val.Value, Log>

interface IExp {
	type: string
	parent: Node | null

	eval(): ValueWithLog
	infer(): ValueWithLog
	print(): string
}

export class Sym implements IExp {
	public type: 'sym' = 'sym'
	public parent: Node | null = null

	private constructor(public name: string) {}

	public resolve(): WithLog<Node, Log> {
		let ref = this.parent

		while (ref) {
			if (ref.type === 'scope' && this.name in ref.vars) {
				return withLog(ref.vars[this.name])
			}

			ref = ref.parent
		}

		if (this.name in GlobalScope.vars) {
			return withLog(GlobalScope.vars[this.name])
		}

		const log: Log = {
			level: 'error',
			ref: this,
			reason: `Variable not bound: ${this.name}`,
		}

		return withLog(obj(Val.bottom), [log])
	}

	public eval(): ValueWithLog {
		return bindWithLog(this.resolve(), v => v.eval())
	}

	public infer(): ValueWithLog {
		return bindWithLog(this.resolve(), v => v.infer())
	}

	public print() {
		return this.name
	}

	public static of(name: string) {
		return new Sym(name)
	}
}

export const sym = Sym.of

export class Int implements IExp {
	public type: 'int' = 'int'
	public parent: Node | null = null

	private constructor(public value: number) {}

	public eval(): ValueWithLog {
		return withLog(Val.int(this.value))
	}

	public infer(): ValueWithLog {
		return withLog(Val.int(this.value))
	}

	public print() {
		return this.value.toString()
	}

	public static of(value: number) {
		return new Int(value)
	}
}

export const int = Int.of

export class Bool implements IExp {
	public type: 'bool' = 'bool'
	public parent: Node | null = null

	private constructor(public value: boolean) {}

	public eval(): ValueWithLog {
		return withLog(Val.bool(this.value))
	}

	public infer(): ValueWithLog {
		return withLog(Val.bool(this.value))
	}

	public print() {
		return this.value.toString()
	}

	public static of(value: boolean) {
		return new Bool(value)
	}
}

export const bool = Bool.of

export class Obj implements IExp {
	public type: 'obj' = 'obj'
	public parent: Node | null = null

	private constructor(public value: Val.Value) {}

	public eval(): ValueWithLog {
		return withLog(this.value)
	}

	public infer(): ValueWithLog {
		if (
			this.value.type === 'tyAtom' ||
			this.value.type === 'tyFn' ||
			this.value.type === 'tyUnion'
		) {
			return withLog(Val.singleton(this.value))
		}
		return withLog(this.value)
	}

	public print() {
		return '<JS Object>:' + this.value.print()
	}

	public static of(value: Val.Value) {
		return new Obj(value)
	}
}

export const obj = Obj.of

export class Fn implements IExp {
	public type: 'fn' = 'fn'
	public parent: Node | null = null

	private constructor(public param: Record<string, Node>, public body: Node) {
		values(param).forEach(p => (p.parent = this))
		body.parent = this
	}

	public infer(): ValueWithLog {
		const {result: param, log: paramLog} = mapWithLog(values(this.param), exp =>
			exp.infer()
		)
		const {result: out, log: outLog} = this.body.infer()
		return withLog(Val.tyFn(param, out), [...paramLog, ...outLog])
	}

	public eval(): ValueWithLog {
		// NOTE: write how to evaluate
		return withLog(Val.bottom)
	}

	public print(): string {
		const params = entries(this.param)
			.map(([k, v]) => `${k}:${v.print()}`)
			.join(' ')
		const body = this.body.print()

		return `(-> {${params}} ${body})`
	}

	public static of(param: Record<string, Node>, body: Node) {
		return new Fn(param, body)
	}
}

export const fn = Fn.of

export class Call implements IExp {
	public type: 'call' = 'call'
	public parent: Node | null = null

	private constructor(public fn: Node, public args: Node[]) {
		fn.parent = this
		args.forEach(a => (a.parent = this))
	}

	public eval(): ValueWithLog {
		const {result: fn, log: fnLog} = this.fn.eval()
		const logs: Log[] = []

		if (fn.type !== 'fn') return withLog(fn, fnLog)

		const convertedArgs = entries(fn.tyParam).map(([name, p], i) => {
			const a = this.args[i]

			if (!a) {
				logs.push({
					level: 'error',
					ref: this,
					reason: `Insufficient argument: ${name}`,
				})
				return p.convert(Val.bottom)
			}

			const {result: aTy, log: inferLog} = a.infer()
			const {result: aVal, log: evalLog} = a.eval()
			logs.push(...inferLog, ...evalLog)

			if (!aTy.isSubtypeOf(p) || aVal.type === 'bottom') {
				if (aVal.type !== 'bottom') {
					logs.push({
						level: 'error',
						ref: this,
						reason: `Parameter ${name} expects type: ${p.print()}, but got: ${aTy.print()}`,
					})
				}
				return p.convert(aVal)
			}

			return aVal
		})

		const result = fn.value(...convertedArgs)

		return withLog(result, [...fnLog, ...logs])
	}

	public infer(): ValueWithLog {
		return bindWithLog(this.fn.infer(), ty =>
			withLog(ty.type === 'tyFn' ? ty.out : ty)
		)
	}

	public print(): string {
		const fn = this.fn.print()
		const args = this.args.map(a => a.print()).join(' ')

		return `(${fn} ${args})`
	}

	public static of(fn: Node, args: Node[]) {
		return new Call(fn, args)
	}
}

export const call = Call.of

export class Scope implements IExp {
	public type: 'scope' = 'scope'
	public parent: Node | null = null

	private constructor(
		public vars: Record<string, Node>,
		public out: Node | null = null
	) {
		values(vars).forEach(v => (v.parent = this))
		if (out) out.parent = this
	}

	public infer(): ValueWithLog {
		return this.out ? this.out.infer() : withLog(Val.bottom)
	}

	public eval(): ValueWithLog {
		return this.out ? this.out.eval() : withLog(Val.bottom)
	}

	public print(): string {
		const vars = entries(this.vars).map(([k, v]) => k + '=' + v.print())
		const out = this.out ? [this.out.print()] : []

		return '{' + [...vars, ...out].join(' ') + '}'
	}

	public static of(vars: Record<string, Node>, out: Node | null = null) {
		return new Scope(vars, out)
	}
}

export const scope = Scope.of

export function isEqual(a: Node, b: Node): boolean {
	switch (a.type) {
		case 'sym':
			return b.type === 'sym' && a.name === b.name
		case 'bool':
		case 'int':
		case 'obj':
			return b.type === a.type && a.value === b.value
		case 'fn':
			return (
				b.type === 'fn' &&
				isEqualWith(a.param, b.param, isEqual) &&
				isEqual(a.body, b.body)
			)
		case 'call':
			return b.type === 'call' && isEqualWith(a.args, b.args, isEqual)
		case 'scope': {
			return (
				b.type === 'scope' &&
				((a.out === null && b.out === null) ||
					(a.out !== null && b.out !== null && isEqual(a.out, b.out))) &&
				isEqualWith(a.vars, b.vars, isEqual)
			)
		}
	}
}

const GlobalScope = scope({
	_: obj(Val.bottom),
	Int: obj(Val.tyInt),
	Bool: obj(Val.tyBool),
	'+': obj(
		Val.fn(
			(a: Val.Int, b: Val.Int) => Val.int(a.value + b.value),
			{x: Val.tyInt, y: Val.tyInt},
			Val.tyInt
		)
	),
	'*': obj(
		Val.fn(
			(a: Val.Int, b: Val.Int) => Val.int(a.value * b.value),
			{x: Val.tyInt, y: Val.tyInt},
			Val.tyInt
		)
	),
	'<': obj(
		Val.fn(
			(a: Val.Int, b: Val.Int) => Val.bool(a.value < b.value),
			{x: Val.tyInt, y: Val.tyInt},
			Val.tyBool
		)
	),
	'|': obj(
		Val.fn(
			(t1: Val.Value, t2: Val.Value) => Val.uniteTy(t1, t2),
			{x: Val.tyInt, y: Val.tyInt},
			Val.tyInt
		)
	),
})

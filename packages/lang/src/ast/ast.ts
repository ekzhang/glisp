import {entries, forOwn, fromPairs, keys, values} from 'lodash'

import {Log, WithLog, withLog} from '../log'
import {isEqualArray} from '../util/isEqualArray'
import {isEqualDict} from '../util/isEqualDict'
import {isEqualSet} from '../util/isEqualSet'
import {nullishEqual} from '../util/nullishEqual'
import {Writer} from '../util/Writer'
import {zip} from '../util/zip'
import * as Val from '../val'
import {Env} from './env'
import {shadowTyVars, Unifier} from './unify'

export type Node = Literal | Exp
export type Literal = Sym | Obj | LUnit | LAll | LBottom | LNum | LStr

export type Exp = Call | Scope | EFn | ETyFn | EVec | EDict

export abstract class BaseNode {
	abstract readonly type: string
	parent: Node | null = null

	protected constructor() {
		return this
	}

	abstract print(): string
	protected abstract forceEval(env: Env): WithLog
	abstract infer(env: Env): WithLog
	abstract isSameTo(ast: Node): boolean

	eval = (env = Env.global) => env.memoizeEval(this, () => this.forceEval(env))

	getLog = () => this.eval(Env.global).log
}

export class Sym extends BaseNode {
	readonly type = 'sym' as const

	private constructor(public name: string) {
		super()
	}

	#resolve(
		ref: Node | null,
		env: Env
	): Writer<{node: Node; mode?: 'param' | 'arg' | 'tyVar'}, Log> {
		if (!ref) {
			// If no parent and still couldn't resolve the symbol,
			// assume there's no bound expression for it.
			const log: Log = {
				level: 'error',
				ref: this,
				reason: 'Variable not bound: ' + this.name,
			}

			return Writer.of({node: LUnit.of()}, log)
		}

		if (ref.type === 'scope') {
			if (this.name in ref.vars) {
				return Writer.of({node: ref.vars[this.name]})
			}
		}
		if (ref.type === 'eFn') {
			if (env.isGlobal) {
				// Situation A. While normal evaluation
				if (this.name in ref.param) {
					return Writer.of({node: ref.param[this.name], mode: 'param'})
				}
			} else {
				// Situation B. In a context of function appliction
				const node = env.get(this.name)
				if (node) {
					return Writer.of({node, mode: 'arg'})
				}
				// If no corresponding arg has found for the eFn, pop the env.
				env = env.pop()
			}
		}
		// Resolve tyVars
		if (ref.type === 'eFn' || ref.type === 'eTyFn') {
			if (this.name in ref.tyVars) {
				return Writer.of({node: Obj.of(ref.tyVars[this.name]), mode: 'tyVar'})
			}
		}

		// Resolve with parent node recursively
		return this.#resolve(ref.parent, env)
	}

	protected forceEval = (env: Env): WithLog => {
		return this.#resolve(this.parent, env).bind(({node, mode}) => {
			const value = node.eval(env)

			return mode === 'param'
				? withLog(value.result.defaultValue, ...value.log)
				: value
		})
	}

	infer = (env = Env.global): WithLog => {
		const {node, mode} = this.#resolve(this.parent, env).result

		if (mode) {
			// In cases such as inferring `x` in `(=> [x:(+ 1 2)] x)`,
			// The type of parameter `(+ 1 2)` needs to be *evaluated*
			return node.eval(env)
		} else {
			// othersise, infer it as usual
			return node.infer(env)
		}
	}

	print = () => this.name

	isSameTo = (ast: Node) => ast.type === 'sym' && this.name === ast.name

	static of(name: string) {
		return new Sym(name)
	}
}

export class Obj<V extends Val.Value = Val.Value> extends BaseNode {
	readonly type = 'obj' as const

	private constructor(public readonly value: V) {
		super()
	}

	protected forceEval = () => withLog(this.value)
	infer = () => withLog(this.value.isType ? Val.all : this.value)

	print = () => {
		const ast = this.value.toAst()
		if (ast.type !== 'obj') return ast.print()
		return `<object of ${this.value.type}>`
	}

	isSameTo = (ast: Node) => this.type === ast.type && this.value === ast.value

	static of<V extends Val.Value = Val.Value>(value: V) {
		return new Obj(value)
	}
}

export class LUnit extends BaseNode {
	readonly type = 'lUnit' as const

	protected forceEval = () => withLog(Val.unit)
	infer = this.eval
	print = () => '()'
	isSameTo = (ast: Node) => this.type === ast.type

	static of() {
		return new LUnit()
	}
}

export class LAll extends BaseNode {
	readonly type = 'lAll' as const

	protected forceEval = () => withLog(Val.all)
	infer = this.eval
	print = () => '_'
	isSameTo = (ast: Node) => this.type === ast.type

	static of() {
		return new LAll()
	}
}

export class LBottom extends BaseNode {
	readonly type = 'lBottom' as const

	protected forceEval = () => withLog(Val.bottom)
	infer = () => withLog(Val.all)
	print = () => '_|_'
	isSameTo = (ast: Node) => this.type === ast.type

	static of() {
		return new LBottom()
	}
}

export class LNum extends BaseNode {
	readonly type = 'lNum' as const

	private constructor(public readonly value: number) {
		super()
	}

	protected forceEval = () => withLog(Val.num(this.value))
	infer = this.eval
	print = () => this.value.toString()
	isSameTo = (ast: Node) => this.type === ast.type && this.value === ast.value

	static of(value: number) {
		return new LNum(value)
	}
}

export class LStr extends BaseNode {
	readonly type = 'lStr' as const

	private constructor(public readonly value: string) {
		super()
	}

	protected forceEval = () => withLog(Val.str(this.value))
	infer = this.eval
	print = () => '"' + this.value + '"'
	isSameTo = (ast: Node) => this.type === ast.type && this.value === ast.value

	static of(value: string) {
		return new LStr(value)
	}
}

export class EFn extends BaseNode {
	readonly type = 'eFn' as const

	readonly tyVars: Record<string, Val.TyVar>

	private constructor(
		tyVars: string[],
		public param: Record<string, Node>,
		public body: Node
	) {
		super()

		this.tyVars = fromPairs(tyVars.map(name => [name, Val.tyVar(name)]))
	}

	protected forceEval = (env: Env): WithLog => {
		const names = keys(this.param)

		const fn: Val.IFn = (...args: Val.Value[]) => {
			const objs = args.map(Obj.of)
			const arg = fromPairs(zip(names, objs))
			const innerEnv = env.extend(arg)
			return this.body.eval(innerEnv)
		}

		const [ty, lty] = this.infer(env).asTuple

		const fnVal = Val.fnFrom(ty, fn, this.body)

		return withLog(fnVal, ...lty)
	}

	infer = (env = Env.global): WithLog<Val.TyFn> => {
		const [param, lp] = Writer.mapValues(this.param, p => p.eval(env)).asTuple

		const innerEnv = env.extend(this.param)

		const [out, lo] = this.body.infer(innerEnv).asTuple

		return withLog(Val.tyFnFrom(param, out), ...lp, ...lo)
	}

	print = (): string => {
		const tyVars = printTyVars(this.tyVars)
		const param = printParam(this.param)
		const body = this.body.print()

		return `(=> ${tyVars}${param} ${body})`
	}

	isSameTo = (ast: Node) =>
		ast.type === 'eFn' &&
		isEqualArray(keys(this.tyVars), keys(ast.tyVars)) &&
		isEqualDict(this.param, ast.param, isSame) &&
		isSame(this.body, ast.body)

	static of(tyVars: string[], param: EFn['param'], body: Node) {
		const fn = new EFn(tyVars, param, body)
		values(param).forEach(p => setParent(p, fn))
		setParent(body, fn)
		return fn
	}
}

export class ETyFn extends BaseNode {
	readonly type = 'eTyFn' as const

	tyVars: Record<string, Val.TyVar>

	private constructor(
		tyVars: string[],
		public param: Record<string, Node>,
		public out: Node
	) {
		super()

		this.tyVars = fromPairs(tyVars.map(name => [name, Val.tyVar(name)]))
	}

	protected forceEval = (env: Env): WithLog => {
		const [params, lp] = Writer.mapValues(this.param, p => p.eval(env)).asTuple
		const [out, lo] = this.out.eval(env).asTuple
		return withLog(Val.tyFnFrom(params, out), ...lp, ...lo)
	}

	infer = () => withLog(Val.all)

	print = (): string => {
		const tyVars = printTyVars(this.tyVars)
		const param = printParam(this.param)
		const out = this.out.print()
		return `(-> ${tyVars}${param} ${out})`
	}

	isSameTo = (ast: Node): boolean =>
		ast.type === 'eTyFn' &&
		isEqualArray(keys(this.tyVars), keys(ast.tyVars)) &&
		isEqualDict(this.param, ast.param, isSame) &&
		isSame(this.out, this.out)

	static of(tyVars: string[], param: Node | Node[], out: Node) {
		const paramArr = [param].flat()
		const pairs = paramArr.map((p, i) => [i, p] as const)
		const paramDict = Object.fromEntries(pairs)

		const tyFn = new ETyFn(tyVars, paramDict, out)

		paramArr.forEach(p => setParent(p, tyFn))
		setParent(out, tyFn)

		return tyFn
	}

	static from(tyVars: string[], param: Record<string, Node>, out: Node) {
		const tyFn = new ETyFn(tyVars, param, out)
		forOwn(param, p => setParent(p, tyFn))
		setParent(out, tyFn)
		return tyFn
	}
}

function printTyVars(tyVars: Record<string, Val.TyVar>): string {
	const es = keys(tyVars)
	if (es.length === 0) return ''
	return '<' + es.join(' ') + '> '
}

function printParam(param: Record<string, Node>) {
	const params = entries(param)

	const canOmitBracket =
		params.length === 1 &&
		!(params[0][1].type === 'eVec' && params[0][1].length === 0)

	const paramStr = params.map(printNamedNode).join(' ')

	return canOmitBracket ? paramStr : '[' + paramStr + ']'

	function printNamedNode([name, ty]: [string, Node]) {
		if (/^[0-9]+$/.test(name)) return ty.print()
		return name + ':' + ty.print()
	}
}

export class EVec extends BaseNode {
	readonly type = 'eVec' as const

	private constructor(public items: Node[], public rest: Node | null = null) {
		super()
	}

	get length() {
		return this.items.length
	}

	protected forceEval = (env: Env): WithLog => {
		const [items, li] = Writer.map(this.items, i => i.eval(env)).asTuple
		const [rest, lr] = this.rest?.eval(env).asTuple ?? [undefined, []]
		return withLog(Val.vecFrom(items, rest), ...li, ...lr)
	}

	infer = (env = Env.global): WithLog => {
		if (this.rest) return withLog(Val.all)
		const [items, log] = Writer.map(this.items, it => it.infer(env)).asTuple
		return withLog(Val.vec(...items), ...log)
	}

	print = (): string => {
		const items = this.items.map(it => it.print())
		const rest = this.rest ? ['...' + this.rest.print()] : []
		return '[' + [...items, ...rest].join(' ') + ']'
	}

	isSameTo = (ast: Node): boolean =>
		ast.type === 'eVec' &&
		isEqualArray(this.items, ast.items, isSame) &&
		nullishEqual(this.rest, this.rest, isSame)

	static of(...items: Node[]) {
		const vec = new EVec(items)
		items.forEach(it => setParent(it, vec))
		return vec
	}

	static from(items: Node[], rest: Node | null = null) {
		const vec = new EVec(items, rest)
		items.forEach(it => setParent(it, vec))
		if (rest) setParent(rest, vec)
		return vec
	}
}

export class EDict extends BaseNode {
	readonly type = 'eDict' as const

	private constructor(
		public items: Record<string, Node>,
		public optionalKeys: Set<string>,
		public rest?: Node
	) {
		super()
	}

	#isOptional(key: string) {
		return this.optionalKeys.has(key)
	}

	infer = (env = Env.global): WithLog => {
		if (this.optionalKeys.size > 0 || this.rest) return withLog(Val.all)

		const [items, logs] = Writer.mapValues(this.items, it =>
			it.infer(env)
		).asTuple
		return withLog(Val.dict(items), ...logs)
	}

	protected forceEval = (env: Env): WithLog => {
		const [items, li] = Writer.mapValues(this.items, it => it.eval(env)).asTuple
		const [rest, lr] = this.rest ? this.rest.eval(env).asTuple : [undefined, []]
		return withLog(Val.dict(items, this.optionalKeys, rest), ...li, ...lr)
	}

	print = (): string => {
		const items = entries(this.items).map(
			([k, v]) => k + (this.#isOptional(k) ? '?' : '') + ': ' + v.print()
		)
		const rest = this.rest ? ['...' + this.rest.print()] : []
		return '{' + [...items, ...rest].join(' ') + '}'
	}

	isSameTo = (ast: Node): boolean =>
		ast.type === 'eDict' &&
		isEqualDict(this.items, ast.items, isSame) &&
		isEqualSet(this.optionalKeys, ast.optionalKeys) &&
		nullishEqual(this.rest, ast.rest, isSame)

	static of(items: Record<string, Node>) {
		return EDict.from(items)
	}

	static from(
		items: Record<string, Node>,
		optionalKeys: Iterable<string> = [],
		rest?: Node
	) {
		const dict = new EDict(items, new Set(optionalKeys), rest)
		values(items).forEach(it => setParent(it, dict))
		if (rest) setParent(rest, dict)
		return dict
	}
}

export class Call extends BaseNode {
	readonly type = 'call' as const

	private constructor(public fn: Node, public args: Node[]) {
		super()
	}

	#unify(env: Env): [Unifier, Val.Value[]] {
		const ty = this.fn.infer(env).result

		if (!('tyFn' in ty)) return [new Unifier(), []]

		const tyFn = ty.tyFn

		const params = values(tyFn.param)

		const shadowedArgs = this.args
			.slice(0, params.length)
			.map(a => shadowTyVars(a.infer(env).result))

		const unifier = new Unifier([
			Val.vec(...params),
			'>=',
			Val.vec(...shadowedArgs),
		])

		return [unifier, shadowedArgs]
	}

	protected forceEval = (env: Env): WithLog => {
		// Evaluate the function itself at first
		const [fn, fnLog] = this.fn.eval(env).asTuple

		// Check if it's not a function
		if (!('fn' in fn)) {
			return Writer.of(fn, ...fnLog, {
				level: 'warn',
				ref: this,
				reason: 'Not a function',
			})
		}

		// Start function application
		const argLog: Log[] = []
		const names = keys(fn.tyFn.param)
		const params = values(fn.tyFn.param)

		// Length-check of arguments
		const lenArgs = this.args.length
		const lenParams = params.length

		if (lenArgs !== lenParams) {
			argLog.push({
				level: 'info',
				ref: this,
				reason: `Expected ${lenParams} arguments, but got ${lenArgs}`,
			})
		}

		// Unify tyFn and args
		const [unifier, shadowedArgs] = this.#unify(env)
		const unifiedParams = params.map(p => unifier.substitute(p))
		const unifiedArgs = shadowedArgs.map(a => unifier.substitute(a))

		// Check types of args and cast them to default if necessary
		const args = unifiedParams.map((pTy, i) => {
			const aTy = unifiedArgs[i] ?? Val.unit
			const name = names[i]

			if (!Val.isSubtype(aTy, pTy)) {
				if (aTy.type !== 'unit') {
					argLog.push({
						level: 'error',
						ref: this,
						reason:
							`Argument '${name}' expects type: ${pTy.print()}, ` +
							`but got: ${aTy.print()}`,
					})
				}
				return pTy.defaultValue
			}

			const [aVal, aLog] = this.args[i].eval(env).asTuple

			argLog.push(...aLog)

			return aVal
		})

		// Call the function
		const [result, callLog] = fn.fn(...args).asTuple
		const unifiedResult = unifier.substitute(result, true)

		// Set this as 'ref'
		const callLogWithRef = callLog.map(log => ({...log, ref: this}))

		return withLog(unifiedResult, ...fnLog, ...argLog, ...callLogWithRef)
	}

	infer = (env = Env.global): WithLog => {
		const [ty, log] = this.fn.infer(env).asTuple
		if (!('tyFn' in ty)) return withLog(ty, ...log)

		if (ty.type === 'fn' && ty.isTypeCtor) {
			return this.eval(env)
		}

		const [unifier] = this.#unify(env)
		return withLog(unifier.substitute(ty.tyFn.out, true), ...log)
	}

	print = (): string => {
		const fn = this.fn.print()
		const args = this.args.map(a => a.print())

		return '(' + [fn, ...args].join(' ') + ')'
	}

	isSameTo = (ast: Node) =>
		ast.type === 'call' && isEqualArray(this.args, ast.args, isSame)

	static of(fn: Node, ...args: Node[]) {
		const app = new Call(fn, args)
		setParent(fn, app)
		args.forEach(a => setParent(a, app))
		return app
	}
}

export class Scope extends BaseNode {
	readonly type = 'scope' as const

	private constructor(
		public vars: Record<string, Node>,
		public out: Node | null = null
	) {
		super()
	}

	infer = (env = Env.global): WithLog =>
		this.out?.infer(env) ?? withLog(Val.unit)

	protected forceEval = (env: Env) => this.out?.eval(env) ?? Writer.of(Val.unit)

	print = (): string => {
		const vars = entries(this.vars).map(([k, v]) => k + ' = ' + v.print())
		const out = this.out ? [this.out.print()] : []

		return '(let ' + [...vars, ...out].join(' ') + ')'
	}

	isSameTo = (ast: Node) =>
		ast.type === 'scope' &&
		nullishEqual(this.out, ast.out, isSame) &&
		isEqualDict(this.vars, ast.vars, isSame)

	extend(vars: Record<string, Node>, out: Node | null = null): Scope {
		const scope = new Scope(vars, out)
		scope.parent = this
		return scope
	}

	def(name: string, exp: Node) {
		if (name in this.vars)
			throw new Error(`Variable '${name}' is already defined`)

		setParent(exp, this)
		this.vars[name] = exp

		return this
	}

	defs(vars: Record<string, Node>) {
		for (const [name, exp] of entries(vars)) {
			this.def(name, exp)
		}
	}

	static of(vars: Record<string, Node>, out: Node | null = null) {
		const scope = new Scope(vars, out)
		values(vars).forEach(v => setParent(v, scope))
		if (out) setParent(out, scope)
		return scope
	}
}

export function setParent(exp: Node, parent: Node) {
	if ('parent' in exp) {
		exp.parent = parent
	}
}

export function isSame(a: Node, b: Node): boolean {
	return a.isSameTo(b)
}

export function print(n: Node) {
	return n.print()
}

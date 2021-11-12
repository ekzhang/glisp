import peggy from 'peggy'

import * as Exp from '../exp'
import {GlobalScope} from '../std/global'
import * as Val from '../val'

const parserDefinition = `
Start = _ exp:Node _
	{
		return exp
	}

Node = Scope / Bottom / Fn / TyFn / App / Vec / Int / All / TyVar / Sym

Reserved = "_" / "=>" / "->" / "~>" / "<" [^>]+ ">"

All = "_" { return Exp.obj(Val.all) }

Sym = SymIdent / SymQuoted

SymIdent = !(Reserved End) $([^0-9()[\\]{}\\:\`"] [^()[\\]{}\\:\`" \\t\\n\\r]*)
	{
		return Exp.sym(text())
	}

SymQuoted = "\`" name:$(!"\`" .)+ "\`"
	{
		return Exp.sym(name)
	}

TyVar = "<" id:$[^>]+ ">"
	{
		return Exp.obj(Val.tyVar(id))
	}

Int "Int" = [0-9]+ &End
	{
		const v = parseInt(text())
		return Exp.int(v)
	}

Bottom = "(" _ ")" { return Exp.obj(Val.bottom) }

App "App" = "(" _ fn:Node _ args:AppArg* ")"
	{
		return Exp.app(fn, ...args)
	}

AppArg = arg:Node _ { return arg }

Fn = "(" _ "=>" _ param:FnParam _ body:Node _ ")"
	{
		return Exp.fn(param, body)
	}

FnParam = FnParamMulti / FnParamSingle

FnParamMulti = "(" _ pairs:FnParamPair* _ ")"
	{
		return Object.fromEntries(pairs)
	}

FnParamSingle = pair:FnParamPair
	{
		const [name, type] = pair
		return {[name]: type}
	}

FnParamPair = sym:Sym _ ":" _ type:Node _
	{
		return [sym.name, type]
	}

TyFn = "(" _ "->" _ param:TyFnParam _ out:Node _ ")"
	{
		return Exp.tyFn(param, out)
	}

TyFnParam = 
	"(" _ params:(Node _)* ")" { return params.map(p => p[0]) } /
	param:Node { return [param] }

Vec = "[" _ items:VecItem* rest:VecRest? "]"
	{		
		return Exp.vecFrom(items, rest)
	}

VecItem = !("..." _) item:Node _ { return item }

VecRest = "..." _ rest:Node _ { return rest }

Scope = "{" _ pairs:ScopePair* out:Node? _ "}"
	{
		return Exp.scope(Object.fromEntries(pairs), out ?? null)
	}

ScopePair = s:Sym _ "=" _ node:Node _
	{
		return [s.name, node]
	}


_ "whitespace" = Whitespace*
__ "whitespace" = Whitespace+

EOF = _ !.
End = EOF / Whitespace / [()[\\]{}\\:]

Whitespace = $[ \\t\\n\\r]
`

const parserSource = peggy.generate(parserDefinition, {
	exportVar: {Exp, Val},
	output: 'source',
})

const parser = eval(parserSource)

export function parse(str: string): Exp.Node {
	const exp: Exp.Node | undefined = parser.parse(str)
	if (!exp) return Exp.obj(Val.bottom)

	exp.parent = GlobalScope

	return exp
}

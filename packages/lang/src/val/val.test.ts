import * as Val from '.'

describe('subtype', () => {
	const square = Val.fn(
		(x: Val.Int) => Val.int(x.value ** 2),
		Val.tyFn([Val.TyInt], Val.TyInt)
	)

	const addTwo = Val.fn(
		(a: Val.Int, b: Val.Int) => Val.int(a.value + b.value),
		Val.tyFn([Val.TyInt, Val.TyInt], Val.TyInt)
	)

	run(Val.int(1), Val.TyInt, true)
	run(Val.TyInt, Val.TyInt, true)
	run(Val.int(1), Val.int(1), true)
	run(Val.bool(true), Val.bool(true), true)
	run(Val.bool(false), Val.bool(false), true)
	run(Val.int(1), Val.bool(false), false)
	run(Val.int(1), Val.All.i, true)
	run(Val.bottom, Val.TyInt, true)

	run(square, square, true)
	run(square, Val.All.i, true)
	run(square, Val.tyFn([Val.TyInt], Val.TyInt), true)
	run(square, Val.tyFn([Val.All.i], Val.TyInt), false)
	run(square, Val.tyFn([Val.TyInt], Val.All.i), true)
	run(square, Val.tyFn([Val.TyInt, Val.TyInt], Val.TyInt), true)
	run(square, Val.tyFn([], Val.TyInt), false)

	run(square, addTwo, false)
	run(addTwo, square, false)

	run(Val.TyInt, new Val.TyUnion([Val.TyInt, Val.TyBool]), true)
	run(Val.int(0), new Val.TyUnion([Val.int(0), Val.int(1)]), true)

	function run(sub: Val.Value, sup: Val.Value, expected: boolean) {
		const op = expected ? '<:' : '!<:'
		test(`${print(sub)} ${op} ${print(sup)}`, () => {
			expect(sub.isSubtypeOf(sup)).toBe(expected)
		})
	}

	function print(v: Val.Value) {
		if (v === square) return 'square'
		if (v === addTwo) return 'addTwo'
		return v.print()
	}
})

describe('normalizing union type', () => {
	run([Val.int(1)], '1')
	run([Val.int(1), Val.int(2)], '(| 1 2)')
	run([Val.int(1), Val.TyInt], '(tyAtom Int)')
	run([Val.TyInt, Val.int(1)], '(tyAtom Int)')
	run([Val.TyInt, Val.TyBool], '(| (tyAtom Int) (tyAtom Bool))')
	run([Val.TyInt, Val.all], 'All')
	run([], '_')
	run([Val.bottom, Val.bottom], '_')
	run([Val.bottom, Val.all], 'All')
	run(
		[Val.TyBool, new Val.TyUnion([Val.TyInt, Val.TyBool]), Val.TyInt],
		'(| (tyAtom Bool) (tyAtom Int))'
	)

	function run(types: Val.Value[], expected: string) {
		test(`(| ${types.map(t => t.print()).join(' ')}) to be ${expected}`, () => {
			expect(Val.uniteTy(...types).print()).toBe(expected)
		})
	}
})

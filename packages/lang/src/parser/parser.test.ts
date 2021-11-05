import {bool, call, int, isEqual, Node, scope, sym, vec} from '../exp'
import {parse} from '.'

describe('parsing literals', () => {
	testParsing('10', int(10))
	testParsing('   10   ', int(10))
	testParsing('false', bool(false))
	testParsing('true', bool(true))
	testParsing('   \t 5 \r\n', int(5))
})

describe('parsing vars', () => {
	run('foo', 'foo')
	run('BAR', 'BAR')
	run('true1', 'true1')
	run('abc123 ', 'abc123')
	run('+-*/&|<=>_', '+-*/&|<=>_')
	run('変数', '変数')
	run('🍡', '🍡')

	function run(input: string, expected: string) {
		testParsing(input, sym(expected))
	}
})

describe('parsing call expressions', () => {
	testParsing('(+ 1 2)', call(sym('+'), int(1), int(2)))
	testParsing('(f)', call(sym('f')))
	testParsing('(0 false)', call(int(1), bool(false)))
	testParsing('((true) pi)', call(call(bool(true)), sym('pi')))
})

describe('parsing scope', () => {
	testParsing('{a = 1 a}', scope({a: int(1)}, sym('a')))
	testParsing('{a = 1}', scope({a: int(1)}))
	testParsing('{a = {a = 1}}', scope({a: scope({a: int(1)})}))
	testParsing('{{1}}', scope({}, scope({}, int(1))))
})

describe('parsing vector', () => {
	testParsing('\t[   ]  ', vec())
	testParsing('[    1   \t]', vec(int(1)))
	testParsing('[1 2 3]', vec(int(1), int(2), int(3)))
	testParsing('[1[2]3   ]', vec(int(1), vec(int(2)), int(3)))
	testParsing(
		'[(+)false(+)+]',
		vec(call(sym('+')), bool(false), call(sym('+')), sym('+'))
	)
})

function testParsing(input: string, expected: Node) {
	test(`parsing '${input}'`, () => {
		const result = parse(input)
		if (!isEqual(result, expected)) {
			fail('Got=' + result.print())
		}
	})
}

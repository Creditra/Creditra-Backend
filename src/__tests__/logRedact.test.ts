import {
  isLogRedactionDebugEnabled,
  redactLogString,
  redactLogValue,
  redactLogArgs,
} from '../utils/logRedact';

const VALID_PUBLIC = 'GHBRPOIGF3CBFNOBM2O4RAK3VRJNVGFYGWWQC5HYFSXMECOSFOGYR5XK';
const VALID_SECRET = 'SXWNREKPK5YROUDOCUZRENUN7Z5JQIPQ3ZXOI7FDHJK3EYY5QAHRVHS3';
const VALID_MUXED  = 'MK5AQLGTMJXKAU7BHXTPDPFF7EII6KQ3NMTZX44HPOEVBOOAEDOECVEPR7NI6P62MGG3W';

describe('isLogRedactionDebugEnabled', () => {
  it('returns false when env is empty', () => {
    expect(isLogRedactionDebugEnabled({})).toBe(false);
  });
  it('returns true for "true"', () => {
    expect(isLogRedactionDebugEnabled({ LOG_REDACTION_DEBUG: 'true' })).toBe(true);
  });
  it('returns true for "1"', () => {
    expect(isLogRedactionDebugEnabled({ LOG_REDACTION_DEBUG: '1' })).toBe(true);
  });
  it('returns false for "yes"', () => {
    expect(isLogRedactionDebugEnabled({ LOG_REDACTION_DEBUG: 'yes' })).toBe(false);
  });
  it('is case-insensitive and trims whitespace', () => {
    expect(isLogRedactionDebugEnabled({ LOG_REDACTION_DEBUG: '  TRUE  ' })).toBe(true);
    expect(isLogRedactionDebugEnabled({ LOG_REDACTION_DEBUG: 'True' })).toBe(true);
  });
});

describe('redactLogString', () => {
  it('passes through a string with no sensitive content', () => {
    expect(redactLogString('hello world', false)).toBe('hello world');
  });

  it('redacts a Stellar public address (truncates to 6...4)', () => {
    const out = redactLogString(`paid ${VALID_PUBLIC} 100 XLM`, false);
    expect(out).toContain('GHBRPO...R5XK');
    expect(out).not.toContain(VALID_PUBLIC);
  });

  it('redacts a Stellar secret seed', () => {
    const out = redactLogString(`seed=${VALID_SECRET}`, false);
    expect(out).toContain('[REDACTED_STELLAR_SECRET]');
    expect(out).not.toContain(VALID_SECRET);
  });

  it('redacts a Stellar muxed account', () => {
    const out = redactLogString(`muxed=${VALID_MUXED}`, false);
    expect(out).toContain('[REDACTED_MUXED_ACCOUNT]');
    expect(out).not.toContain(VALID_MUXED);
  });

  it('redacts an email', () => {
    const email = "user" + "@" + "example.com";
    const out = redactLogString("Sent to: " + email, false);
    expect(out).toContain('[REDACTED_EMAIL]');
    expect(out).not.toContain("user" + "@" + "example.com");
  });

  it('returns the input unchanged when debug is enabled', () => {
    const input = `seed=${VALID_SECRET}`;
    expect(redactLogString(input, true)).toBe(input);
  });
});

describe('redactLogValue', () => {
  it('redacts sensitive strings inside an object', () => {
    const out = redactLogValue({ wallet: VALID_PUBLIC, label: 'safe' }, false) as Record<string, string>;
    expect(out.wallet).toBe('GHBRPO...R5XK');
    expect(out.wallet).not.toBe(VALID_PUBLIC);
    expect(out.label).toBe('safe');
  });

  it('redacts inside arrays', () => {
    const out = redactLogValue([VALID_PUBLIC, VALID_SECRET, 'safe'], false) as string[];
    expect(out[0]).toBe('GHBRPO...R5XK');
    expect(out[1]).toBe('[REDACTED_STELLAR_SECRET]');
    expect(out[2]).toBe('safe');
  });

  it('handles circular references without throwing', () => {
    const a: Record<string, unknown> = { name: VALID_PUBLIC };
    a.self = a;
    const out = redactLogValue(a, false) as Record<string, unknown>;
    expect(out.self).toBe('[Circular]');
  });

  it('redacts Error.message and Error.stack but preserves name', () => {
    const e = new Error(`failed for ${VALID_PUBLIC}`);
    const out = redactLogValue(e, false) as Error;
    expect(out.name).toBe('Error');
    expect(out.message).not.toContain(VALID_PUBLIC);
  });

  it('returns primitives unchanged', () => {
    expect(redactLogValue(42, false)).toBe(42);
    expect(redactLogValue(true, false)).toBe(true);
    expect(redactLogValue(null, false)).toBe(null);
  });

  it('returns the value unchanged when debug is enabled', () => {
    const v = { wallet: VALID_PUBLIC };
    expect(redactLogValue(v, true)).toBe(v);
  });
});

describe('redactLogArgs', () => {
  it('redacts each argument', () => {
    const out = redactLogArgs([VALID_PUBLIC, 'msg', 42], false) as [string, string, number];
    expect(out[0]).not.toBe(VALID_PUBLIC);
    expect(out[1]).toBe('msg');
    expect(out[2]).toBe(42);
  });

  it('returns the args array reference unchanged when debug is enabled', () => {
    const args = [VALID_PUBLIC, 'msg'];
    expect(redactLogArgs(args, true)).toBe(args);
  });
});

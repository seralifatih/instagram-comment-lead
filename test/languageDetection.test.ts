import { detectLanguage, setLanguageConfigForTests, DEFAULT_LANGUAGE_DETECTION } from '../src/main.js';

describe('language detection', () => {
  beforeEach(() => {
    setLanguageConfigForTests({ ...DEFAULT_LANGUAGE_DETECTION, enableFastText: false });
  });

  test('detects Hindi by script', () => {
    const lang = detectLanguage('\u0939\u093f\u0928\u094d\u0926\u0940 \u092d\u093e\u0937\u093e \u092e\u0947\u0902');
    expect(lang).toBe('hi');
  });

  test('detects English by stopwords', () => {
    const lang = detectLanguage('this is a simple test and you are here');
    expect(lang).toBe('en');
  });

  test('detects Spanish by stopwords', () => {
    const lang = detectLanguage('como estas y donde esta la informacion');
    expect(lang).toBe('es');
  });
});

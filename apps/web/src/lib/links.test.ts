import { describe, expect, it } from 'vitest';
import { splitLinks } from './links';

describe('item 70: links no texto', () => {
  it('acha http, https, www e e-mail', () => {
    expect(splitLinks('Veja https://nerus.com.br/a?b=1 e www.google.com, ou escreva para ana@nerus.com.br.')).toEqual([
      { text: 'Veja ' },
      { text: 'https://nerus.com.br/a?b=1', href: 'https://nerus.com.br/a?b=1' },
      { text: ' e ' },
      { text: 'www.google.com', href: 'https://www.google.com' },
      { text: ', ou escreva para ' },
      { text: 'ana@nerus.com.br', href: 'mailto:ana@nerus.com.br' },
      { text: '.' },
    ]);
  });
  it('tira a pontuação da frase e o parêntese que não é do endereço', () => {
    expect(splitLinks('(ver http://x.com/a)')).toEqual([{ text: '(ver ' }, { text: 'http://x.com/a', href: 'http://x.com/a' }, { text: ')' }]);
    expect(splitLinks('http://pt.wikipedia.org/wiki/Rio_(cidade)!')[0].href).toBe('http://pt.wikipedia.org/wiki/Rio_(cidade)');
  });
  it('não cria link de javascript: nem de texto comum', () => {
    expect(splitLinks('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }]);
    expect(splitLinks('Ligar às 10h. Sem link aqui.')).toEqual([{ text: 'Ligar às 10h. Sem link aqui.' }]);
    expect(splitLinks('')).toEqual([]);
  });
  it('mantém as quebras de linha', () => {
    expect(splitLinks('a\nhttps://b.com\nc').map((p) => p.text).join('')).toBe('a\nhttps://b.com\nc');
  });
});

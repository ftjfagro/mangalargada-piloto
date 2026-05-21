# Mangalargada 2026 — App do fiscal

App PWA para captura de passagens no Enduro Mangalargada 2026.

## Funcionalidades

- Captura de foto com horário queimado na imagem
- Registro de 1, 2 ou 3 coletes por passagem
- 5 postos: Largada, PC1, PC2, PC3, Chegada
- Persistência local em IndexedDB (não perde dados se fechar)
- Sincronização automática com Google Sheets via Apps Script
- Funciona offline e sincroniza quando o sinal volta
- Instalável como app no celular (Android/iOS)

## Como rodar localmente

Abra `index.html` em qualquer navegador. Como é um PWA, o navegador serve direto.

## Como usar

1. Identifique-se com nome do fiscal
2. Escolha o posto que vai cobrir
3. Para cada passagem:
   - Tire a foto no momento exato
   - Digite o(s) número(s) do(s) colete(s)
   - Toque em "Salvar registro"

O app sincroniza automaticamente quando há sinal.

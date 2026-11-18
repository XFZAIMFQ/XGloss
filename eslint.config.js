import js from '@eslint/js'
import globals from 'globals'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'

export default ts.config(
    { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'public/**'] },
    js.configs.recommended,
    { languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.webextensions } } },
    ...ts.configs.recommended,
    ...vue.configs['flat/recommended'],
    {
        files: ['**/*.vue'],
        languageOptions: { parserOptions: { parser: ts.parser } },
        rules: {
            'no-undef': 'off',
            'vue/multi-word-component-names': 'off',
            'vue/html-self-closing': 'off',
            'vue/max-attributes-per-line': 'off',
            'vue/html-indent': 'off',
            'vue/html-closing-bracket-newline': 'off',
            'vue/multiline-html-element-content-newline': 'off',
            'vue/singleline-html-element-content-newline': 'off',
        },
    },
    { files: ['scripts/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', fetch: 'readonly', URL: 'readonly' } } },
)

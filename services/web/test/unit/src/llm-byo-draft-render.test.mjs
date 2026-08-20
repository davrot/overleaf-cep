// Repro for React #137 ('got: input') when opening the BYO "Add provider" draft.
// DEV-mode render so the full error message + component stack are visible.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, beforeAll } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  })
})

describe('llm byo add-provider draft', () => {
  it('renders the draft without throwing React #137', async () => {
    process.env.NODE_ENV = 'development'
    const { default: LLMSettingsSection } =
      await import('../../../modules/llm/frontend/js/components/llm-settings-section')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(React.createElement(LLMSettingsSection))
    })

    const buttons = () =>
      [...container.querySelectorAll('button')].map((b) => (b.textContent || '').trim())
    const addBtn =
      [...container.querySelectorAll('button')].find((b) =>
        (b.textContent || '').includes('Add provider'),
      ) || null

    let clickErr
    if (addBtn) {
      await act(async () => {
        try {
          addBtn.click()
        }
        catch (e) {
          clickErr = e
        }
      })
      await act(async () => {})
    }

    console.log('BUTTONS BEFORE CLICK:', JSON.stringify(buttons()))
    console.log('BUTTONS AFTER CLICK:', JSON.stringify(buttons()))
    console.log('EDITOR PRESENT:', !!container.querySelector('.llm-buo-editor'))
    if (clickErr) console.log('CLICK ERROR:', clickErr)

    expect(clickErr).toBeUndefined()
    expect(!!container.querySelector('.llm-buo-editor')).toBe(true)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})

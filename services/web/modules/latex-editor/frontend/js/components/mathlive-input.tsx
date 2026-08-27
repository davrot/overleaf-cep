import { FC, useEffect, useRef, MutableRefObject } from 'react'
import { debugConsole } from '@/utils/debugging'

type Props = {
  value: string
  onChange: (latex: string) => void
  mathfieldRef: MutableRefObject<any>
  keyboardVisible: boolean
}

/**
 * MathLive math-field wrapper.
 *
 * MathLive is bundled from the npm package (no CDN): the JS is a webpack
 * async chunk and the fonts are served from the local
 * `js/libs/mathlive-<version>/fonts` assets copied into the image at build
 * time.
 *
 * If MathLive cannot initialise (e.g. no math-field support), it degrades to
 * a plain LaTeX textarea so the editor keeps working.
 */
export const MathLiveInput: FC<Props> = ({
  value,
  onChange,
  mathfieldRef,
  keyboardVisible,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)
  const fallback = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    let mathfield: any = null

    const renderFallback = () => {
      if (!containerRef.current) return
      containerRef.current.innerHTML = ''
      const ta = document.createElement('textarea')
      ta.className = 'form-control equation-editor-raw-textarea'
      ta.value = value
      ta.setAttribute('aria-label', 'LaTeX equation input')
      ta.addEventListener('input', () => {
        onChange(ta.value)
      })
      containerRef.current.appendChild(ta)
      mathfieldRef.current = {
        getValue: () => ta.value,
        setValue: (v: string) => {
          ta.value = v
          onChange(v)
        },
        focus: () => ta.focus(),
        executeCommand: (cmd: string | string[]) => {
          const text = Array.isArray(cmd) ? cmd[1] : cmd
          if (!text) return
          const start = ta.selectionStart
          const end = ta.selectionEnd
          ta.value = ta.value.slice(0, start) + text + ta.value.slice(end)
          ta.selectionStart = ta.selectionEnd = start + text.length
          onChange(ta.value)
        },
      }
    }

    const init = async () => {
      try {
        const mathlive = await import('mathlive')

        const MFE = mathlive.MathfieldElement
        if (MFE) {
          // Serve KaTeX fonts from the locally copied assets (no CDN)
          MFE.fontsDirectory = '/js/libs/mathlive-0.110.0/fonts/'
        }

        if (!containerRef.current) return

        const mf = document.createElement('math-field') as any
        mf.className = 'equation-editor-mathfield'
        mf.setAttribute('smart-mode', 'true')
        mf.setAttribute('smart-fence', 'true')
        mf.setAttribute('smart-superscript', 'true')
        mf.setAttribute('math-virtual-keyboard-policy', 'manual')

        containerRef.current.appendChild(mf)
        mathfield = mf
        mathfieldRef.current = mf

        if (value) {
          mf.setValue(value)
        }

        mf.addEventListener('input', () => {
          onChange(mf.getValue('latex'))
        })
      } catch (err) {
        debugConsole.warn(
          '[latex-editor] MathLive failed to load, using textarea fallback:',
          err
        )
        fallback.current = true
        renderFallback()
      }
    }

    init()

    return () => {
      const kbd = (window as any).mathVirtualKeyboard
      if (kbd && typeof kbd.hide === 'function') {
        kbd.hide()
      }
      if (mathfield && typeof mathfield.remove === 'function') {
        mathfield.remove()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toggle MathLive's virtual keyboard based on the prop
  useEffect(() => {
    if (fallback.current) return
    const kbd = (window as any).mathVirtualKeyboard
    if (!kbd) return
    if (keyboardVisible) {
      kbd.show({ animate: true })
    } else {
      kbd.hide({ animate: true })
    }
  }, [keyboardVisible])

  // Sync external value changes into MathLive
  useEffect(() => {
    if (!mathfieldRef.current) return
    if (fallback.current) return
    const currentValue = mathfieldRef.current.getValue?.('latex') ?? ''
    if (currentValue !== value) {
      mathfieldRef.current.setValue(value)
    }
  }, [value, mathfieldRef])

  return (
    <div className="equation-editor-mathfield-wrapper" ref={containerRef} />
  )
}

export default MathLiveInput

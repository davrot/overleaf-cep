import { expect } from 'chai'
import { render, screen, fireEvent } from '@testing-library/react'

import { Drawer } from '../../../../frontend/js/shared/components/drawer/drawer'

describe('<Drawer /> (mobile plan, Phase 2)', function () {
  function makeCloseSpy() {
    let calls = 0
    return {
      fn: () => {
        calls += 1
      },
      get calls() {
        return calls
      },
    }
  }

  it('renders nothing when isOpen is false', function () {
    const { container } = render(
      <Drawer isOpen={false} title="Files" onClose={() => {}}>
        <span>content</span>
      </Drawer>
    )
    expect(container.querySelector('.drawer')).to.equal(null)
  })

  it('renders a modal dialog labeled by the title when isOpen is true', function () {
    render(
      <Drawer isOpen={true} title="Files" onClose={() => {}}>
        <span>content</span>
      </Drawer>
    )
    const dialog = screen.getByRole('dialog', { name: 'Files' })
    expect(dialog.getAttribute('aria-modal')).to.equal('true')
    expect(dialog.querySelector('.drawer-content span')?.textContent).to.equal('content')
  })

  it('calls onClose when the close button is clicked', function () {
    const spy = makeCloseSpy()
    render(
      <Drawer isOpen={true} title="Files" onClose={spy.fn}>
        <span>content</span>
      </Drawer>
    )
    fireEvent.click(screen.getByTestId('drawer-close'))
    expect(spy.calls).to.equal(1)
  })

  it('calls onClose when Escape is pressed', function () {
    const spy = makeCloseSpy()
    render(
      <Drawer isOpen={true} title="Files" onClose={spy.fn}>
        <span>content</span>
      </Drawer>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(spy.calls).to.equal(1)
  })
})

import { Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export const TAB_USER_EDIT_EVENT = 'tab-user-edit'

export const tabsEvents = new EventTarget()

export const tabsListener = () =>
  EditorView.updateListener.of(update => {
    if (!update.docChanged) return
    for (const transaction of update.transactions) {
      if (!transaction.annotation(Transaction.remote)) {
        tabsEvents.dispatchEvent(new Event(TAB_USER_EDIT_EVENT))
        return
      }
    }
  })

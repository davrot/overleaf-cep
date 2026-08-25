import { describe, it, expect } from 'vitest'
import {
  companionFileName,
  findFileRefById,
  findParentFolderId,
} from '../../../frontend/js/util/drawio-utils.ts'

describe('companionFileName', function () {
  it('strips the .drawio extension and appends the companion kind', function () {
    expect(companionFileName('diagram.drawio', 'png')).toEqual('diagram.png')
    expect(companionFileName('diagram.drawio', 'pdf')).toEqual('diagram.pdf')
    expect(companionFileName('diagram.drawio', 'svg')).toEqual('diagram.svg')
  })

  it('is case-insensitive on the extension and defaults the name', function () {
    expect(companionFileName('My.Diagram.DRAWIO', 'png')).toEqual(
      'My.Diagram.png'
    )
    expect(companionFileName('', 'pdf')).toEqual('diagram.pdf')
  })

  it('keeps non-drawio names as-is', function () {
    expect(companionFileName('diagram', 'png')).toEqual('diagram.png')
  })
})

describe('findParentFolderId', function () {
  const tree = {
    _id: 'root',
    folders: [
      {
        _id: 'figs',
        folders: [
          {
            _id: 'sub',
            fileRefs: [{ _id: 'f1', name: 'f1.png' }],
          },
        ],
        fileRefs: [{ _id: 'diagram', name: 'diagram.drawio' }],
      },
    ],
  }

  it('finds the direct parent folder', function () {
    expect(findParentFolderId(tree, 'diagram')).toEqual('figs')
  })

  it('finds nested parents recursively', function () {
    expect(findParentFolderId(tree, 'f1')).toEqual('sub')
  })

  it('returns null when the entity is not in the tree', function () {
    expect(findParentFolderId(tree, 'nope')).toBeNull()
  })
})

describe('findFileRefById', function () {
  const tree = {
    _id: 'root',
    fileRefs: [{ _id: 'top', name: 'top.png' }],
    folders: [
      {
        _id: 'figs',
        fileRefs: [{ _id: 'nested', name: 'nested.png' }],
      },
    ],
  }

  it('finds top-level file refs', function () {
    const hit = findFileRefById(tree, 'top')
    expect(hit?.name).toEqual('top.png')
  })

  it('finds nested file refs', function () {
    const hit = findFileRefById(tree, 'nested')
    expect(hit?._id).toEqual('nested')
  })

  it('returns null when missing', function () {
    expect(findFileRefById(tree, 'missing')).toBeNull()
  })
})

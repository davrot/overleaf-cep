import Mongoose from '@overleaf/mongoose-wrapper'

const Schema = Mongoose.Schema

const dropboxSyncSchema = new Schema(
  {
    projectId: { type: Schema.Types.Mixed, required: true },
    // Dropbox connection state
    connected: { type: Boolean, default: false },
    path: { type: String, required: true },
    remoteFiles: {
      type: [
        new Schema(
          {
            path: { type: String, required: true },
            rev: { type: String },
            size: { type: Number },
            modifiedAt: { type: Date },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    // Revision tracking for conflict detection (Dropbox uses 'rev' property)
    lastSyncRev: { type: String }, // Last synced revision (from Dropbox's rev property)
    lastSyncVersion: { type: Number }, // Overleaf project version number
    mergeStatus: {
      type: String,
      enum: ['clean', 'diverged', 'conflict'],
      default: 'clean',
    },
    // Sync tracking (optional)
    lastSyncAt: { type: Date }, // Last successful sync time
    lastSyncError: { type: String }, // Error message from last sync attempt
    lastConflict: {
      path: { type: String }, // Path of conflicting file
      localVersion: { type: String },
      remoteRev: { type: String }, // Dropbox uses 'rev' instead of version
      timestamp: { type: Date },
    },
  },
  { timestamps: true }
)

dropboxSyncSchema.index({ projectId: 1 })

export const DropboxSyncProjectStates =
  Mongoose.model('DropboxSyncProjectState', dropboxSyncSchema)

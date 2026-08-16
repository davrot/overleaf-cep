import Mongoose from '@overleaf/mongoose-wrapper'

const Schema = Mongoose.Schema

export const DropboxUserCredentialsSchema = new Schema(
  {
    userId: { type: Schema.Types.Mixed, ref: 'User', required: true, unique: true },
    // Encrypted credentials - contains access_token
    accessToken: { type: String, required: true },
    path: { type: String, default: '/' },
    // Display-only: the Dropbox app folder exactly as it appears in the
    // user’s Dropbox account (e.g. "Apps/Overleaf Dev"). The app folder IS
    // the API sandbox root (path "/"), whose name the API never exposes;
    // this field feeds the display path only — never the sync root.
    displayRoot: { type: String },
  },
  { minimize: false }
)

export const DropboxUserCredentials = Mongoose.model(
  'DropboxUserCredentials',
  DropboxUserCredentialsSchema,
)

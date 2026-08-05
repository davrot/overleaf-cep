import mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose
const { ObjectId } = Schema

const schema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, unique: true },
    credentials: { type: String, required: true },
  },
  { collection: 'webdavUserCredentials', minimize: false }
)

export default mongoose.model('WebdavUserCredentials', schema)
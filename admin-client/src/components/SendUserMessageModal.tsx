import { useEffect, useRef, useState, type DragEvent } from 'react';
import { toast } from 'react-hot-toast';
import { sendUserMessage } from '../services/userService';
import { compressImageFile, type CompressedPhoto } from '../utils/compressImage';

type UserRow = {
  telegram_id: number;
  first_name: string | null;
};

type SendUserMessageModalProps = {
  user: UserRow;
  onClose: () => void;
};

const TEXT_ONLY_MAX = 4096;
const PHOTO_CAPTION_MAX = 1024;

const SendUserMessageModal = ({ user, onClose }: SendUserMessageModalProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const [actionPassword, setActionPassword] = useState('');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    return () => {
      if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    };
  }, [photo?.previewUrl]);

  const maxText = photo ? PHOTO_CAPTION_MAX : TEXT_ONLY_MAX;

  const clearPhoto = () => {
    setPhoto((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const attachFile = async (file: File | undefined) => {
    if (!file) return;
    setCompressing(true);
    try {
      const next = await compressImageFile(file);
      setPhoto((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not attach this photo.');
    } finally {
      setCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    void attachFile(file);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const submit = async () => {
    const messageText = text.trim();
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    if (!messageText && !photo) {
      toast.error('Enter a message or attach a photo.');
      return;
    }
    if (messageText.length > maxText) {
      toast.error(
        photo
          ? 'With a photo, the message can be at most 1024 characters.'
          : 'Message can be at most 4096 characters.'
      );
      return;
    }

    setSending(true);
    try {
      await sendUserMessage({
        telegramId: user.telegram_id,
        text: messageText,
        actionPassword,
        imageBase64: photo?.base64,
      });
      toast.success('Message sent.');
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Message failed.';
      toast.error(
        message === 'invalid_action_password' ? 'Incorrect action password.' : message
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3>Send Message</h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="muted-text">
            To {user.first_name || 'user'} ({user.telegram_id})
          </p>
          <div className="modal-field">
            <label htmlFor="messageActionPassword">Action Password</label>
            <input
              id="messageActionPassword"
              type="password"
              value={actionPassword}
              onChange={(event) => setActionPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="modal-field">
            <label htmlFor="userMessageText">Message</label>
            <textarea
              id="userMessageText"
              value={text}
              maxLength={maxText}
              onChange={(event) => setText(event.target.value)}
              placeholder="Write a message (optional if you attach a photo)"
            />
            <span className="field-helper">
              {text.trim().length}/{maxText}
              {photo ? ' characters with photo' : ' characters'}
            </span>
          </div>
          <div
            className={`message-dropzone${dragOver ? ' is-dragover' : ''}`}
            onDragEnter={onDragEnter}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <input
              id="user-message-photo"
              ref={fileInputRef}
              className="message-file-input"
              type="file"
              accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif"
              disabled={compressing || sending}
              onChange={(event) => void attachFile(event.target.files?.[0])}
            />
            {photo ? (
              <div className="message-photo-preview">
                <img src={photo.previewUrl} alt="Attached preview" />
                <div className="message-photo-actions">
                  <label htmlFor="user-message-photo" className="secondary-button message-attach-label">
                    Change photo
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={clearPhoto}
                    disabled={compressing || sending}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p>{compressing ? 'Compressing photo…' : 'Drag and drop a photo here'}</p>
                <label htmlFor="user-message-photo" className="secondary-button message-attach-label">
                  Attach photo
                </label>
                <span className="field-helper">
                  Works on Windows, Android, and iPhone. Large screenshots are compressed under 1 MB.
                </span>
              </>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void submit()}
            disabled={sending || compressing}
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SendUserMessageModal;

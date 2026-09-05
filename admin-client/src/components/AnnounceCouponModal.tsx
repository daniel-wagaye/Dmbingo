import { useEffect, useRef, useState, type DragEvent } from 'react';
import { toast } from 'react-hot-toast';
import {
  announceCoupon,
  buildCouponAnnounceText,
  DEFAULT_COUPON_ANNOUNCE_IMAGE_URL,
  type CouponRow,
} from '../services/couponService';
import { compressImageFile, type CompressedPhoto } from '../utils/compressImage';

type AnnounceCouponModalProps = {
  coupon: CouponRow;
  onClose: () => void;
  onSent: () => void;
};

const TEXT_MAX = 4096;

const AnnounceCouponModal = ({ coupon, onClose, onSent }: AnnounceCouponModalProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);
  const [actionPassword, setActionPassword] = useState('');
  const [text, setText] = useState(buildCouponAnnounceText(coupon.coupon_code, coupon.max_uses_total));
  const [imageUrl, setImageUrl] = useState(DEFAULT_COUPON_ANNOUNCE_IMAGE_URL);
  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    return () => {
      if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    };
  }, [photo?.previewUrl]);

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
      setImageUrl('');
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
    const url = imageUrl.trim();
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    if (!messageText && !url && !photo) {
      toast.error('Enter a message or attach a photo.');
      return;
    }
    if (messageText.length > TEXT_MAX) {
      toast.error('Message can be at most 4096 characters.');
      return;
    }
    if (url && !/^https?:\/\//i.test(url)) {
      toast.error('Image URL must start with http:// or https://.');
      return;
    }

    setSending(true);
    try {
      await announceCoupon(coupon.coupon_id, {
        admin_password: actionPassword,
        text: messageText,
        imageUrl: photo ? undefined : url || undefined,
        imageBase64: photo?.base64,
      });
      toast.success('Coupon announcement sent.');
      onSent();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Message failed.';
      toast.error(message === 'invalid_action_password' ? 'Incorrect action password.' : message);
    } finally {
      setSending(false);
    }
  };

  const previewSrc = photo?.previewUrl || imageUrl.trim() || '';

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3>Announce Coupon</h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="muted-text">
            Sends to the coupon Telegram group. You can edit the text, clear the photo URL, or attach
            your own image.
          </p>
          <div className="modal-field">
            <label htmlFor="announceActionPassword">Action Password</label>
            <input
              id="announceActionPassword"
              type="password"
              value={actionPassword}
              onChange={(event) => setActionPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="modal-field">
            <label htmlFor="announceText">Message</label>
            <textarea
              id="announceText"
              value={text}
              maxLength={TEXT_MAX}
              rows={12}
              onChange={(event) => setText(event.target.value)}
            />
            <span className="field-helper">
              {text.trim().length}/{TEXT_MAX} characters
            </span>
          </div>
          <div className="modal-field">
            <label htmlFor="announceImageUrl">Photo URL</label>
            <input
              id="announceImageUrl"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="https://..."
              disabled={Boolean(photo)}
            />
            <span className="field-helper">
              Clear this to send text only, or attach a file below to replace it.
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
              id="coupon-announce-photo"
              ref={fileInputRef}
              className="message-file-input"
              type="file"
              accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif"
              disabled={compressing || sending}
              onChange={(event) => void attachFile(event.target.files?.[0])}
            />
            {previewSrc ? (
              <div className="message-photo-preview">
                <img src={previewSrc} alt="Announcement preview" />
                <div className="message-photo-actions">
                  <label htmlFor="coupon-announce-photo" className="secondary-button message-attach-label">
                    {photo ? 'Change photo' : 'Replace with file'}
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      clearPhoto();
                      setImageUrl('');
                    }}
                    disabled={compressing || sending}
                  >
                    Remove photo
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p>{compressing ? 'Compressing photo…' : 'Drag and drop a photo here'}</p>
                <label htmlFor="coupon-announce-photo" className="secondary-button message-attach-label">
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
            {sending ? 'Sending...' : 'Send announcement'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnnounceCouponModal;

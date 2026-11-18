import { useEffect, useRef, useState } from 'react'
import type { Friend, FriendRequest, MyProfile } from '@shared/models'
import { Button } from '../components/Controls'
import { Icon } from '../components/Icon'
import { HStack, VStack } from '../components/Stack'
import { Text } from '../components/Text'
import { resizeImageFileToAvatar } from '../lib/image-resize.ts'
import { loadMyProfile, saveMyProfile } from '../lib/profile.ts'
import { useTr } from '../lib/use-language'
import { importSkillCode, previewSkillCode, type SkillPackage } from '../lib/skill-share.ts'
import { useStore } from '../store/context'
import { usePlugins } from './marketplace/plugins'
import './friends-panel.css'

/** 通讯录: the user's accepted friends (split 在线好友/好友列表) and any pending requests, plus the
 *  add-friend flow (设计文档 "左侧栏与好友系统"). There's no search or directory — the only way in
 *  is an invite code. "在线" is a placeholder (`false` for everyone) until the P2P layer (信令服务器)
 *  tells us who's actually reachable right now; see the `多人协作架构` design-doc section. */
export function FriendsPanel() {
  const tr = useTr()
  const store = useStore()
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [myCode, setMyCode] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const client = await store.ready()
    const [f, r] = await Promise.all([
      client.call<{ items: Friend[] }>('friends'),
      client.call<{ items: FriendRequest[] }>('friendRequests'),
    ])
    setFriends(f.items)
    setRequests(r.items)
  }

  useEffect(() => {
    void refresh()
    void store.ready().then((c) => c.call<{ code: string }>('myInviteCode')).then((r) => setMyCode(r.code))
  }, [])

  const accept = async (id: string) => {
    await (await store.ready()).call('friendAccept', { id })
    await refresh()
  }
  const decline = async (id: string) => {
    await (await store.ready()).call('friendDecline', { id })
    await refresh()
  }
  const remove = async (id: string) => {
    await (await store.ready()).call('friendRemove', { id })
    await refresh()
  }

  return (
    <VStack className="friends-panel" gap={0}>
      <MyProfileSection />
      {requests.length > 0 ? (
        <section className="friends-section">
          <Text as="div" size="caption" weight="semibold" tone="secondary" className="friends-section-title">{tr('Friend requests')}</Text>
          {requests.map((r) => (
            <HStack key={r.id} gap={8} className="friends-row">
              <div className="friends-avatar" aria-hidden="true">{r.name.slice(0, 1).toUpperCase()}</div>
              <Text as="div" grow truncate>{r.name}</Text>
              <HStack gap={4}>
                <Button kind="primary" onClick={() => void accept(r.id)}>{tr('Accept')}</Button>
                <Button kind="secondary" onClick={() => void decline(r.id)}>{tr('Decline')}</Button>
              </HStack>
            </HStack>
          ))}
        </section>
      ) : null}

      <section className="friends-section">
        <Text as="div" size="caption" weight="semibold" tone="secondary" className="friends-section-title">{tr('Friends')}</Text>
        {friends.length === 0 ? (
          <Text as="div" tone="tertiary" className="friends-empty">{tr('No friends yet — add one with an invite code.')}</Text>
        ) : (
          friends.map((f) => (
            <HStack key={f.id} gap={8} className="friends-row">
              <span className="friends-status-dot offline" title={tr('Offline')} />
              <div className="friends-avatar" aria-hidden="true">{f.name.slice(0, 1).toUpperCase()}</div>
              <Text as="div" grow truncate>{f.name}</Text>
              <Button kind="secondary" onClick={() => void remove(f.id)}>{tr('Remove')}</Button>
            </HStack>
          ))
        )}
      </section>

      {adding ? (
        <AddFriendForm
          myCode={myCode}
          onClose={() => setAdding(false)}
          onSubmit={async (code, name) => {
            setError(null)
            try {
              await (await store.ready()).call('friendRequestReceive', { code, name })
              setAdding(false)
              await refresh()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
          error={error}
        />
      ) : (
        <Button kind="secondary" className="friends-add-button" onClick={() => setAdding(true)}>
          <HStack gap={6}><Icon name="plus" size={13} />{tr('Add friend')}</HStack>
        </Button>
      )}

      <ImportSkillForm />
    </VStack>
  )
}

/** This account's own name and avatar photo — shown here rather than inside a settings sheet
 *  because it's part of the friend system: what a friend would eventually see of you once the
 *  group's own P2P channel can carry it over (not wired up yet; see `social::profile`'s doc
 *  comment). The photo is resized client-side (`image-resize.ts`) before it ever reaches the
 *  host, so a multi-megabyte original never gets sent or stored. */
function MyProfileSection() {
  const tr = useTr()
  const store = useStore()
  const fileInput = useRef<HTMLInputElement>(null)
  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadMyProfile(store).then((p) => {
      setProfile(p)
      setName(p.name ?? '')
    })
  }, [])

  const pickFile = () => fileInput.current?.click()

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const avatar = await resizeImageFileToAvatar(file)
      const saved = await saveMyProfile(store, profile?.name ?? null, avatar)
      setProfile(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveName = async () => {
    setError(null)
    try {
      const saved = await saveMyProfile(store, name.trim() || null)
      setProfile(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="friends-section friends-my-profile">
      <Text as="div" size="caption" weight="semibold" tone="secondary" className="friends-section-title">{tr('My profile')}</Text>
      <HStack gap={10} align="center">
        <button type="button" className="friends-my-avatar" onClick={pickFile} disabled={busy} title={tr('Change photo')}>
          {profile?.avatar ? (
            <img src={profile.avatar} alt="" />
          ) : (
            <span aria-hidden="true">{(profile?.name || 'Me').slice(0, 1).toUpperCase()}</span>
          )}
        </button>
        <VStack gap={6} grow>
          <input
            className="friends-code-input"
            value={name}
            placeholder={tr('Your name')}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name.trim() !== (profile?.name ?? '')) void saveName() }}
          />
          <Button kind="secondary" onClick={pickFile} disabled={busy}>{busy ? tr('Updating…') : tr('Change photo')}</Button>
        </VStack>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="friends-avatar-file-input"
          onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
        />
      </HStack>
      {error ? <Text as="div" tone="danger" size="caption">{error}</Text> : null}
    </section>
  )
}

/** 技能分享给好友, the receiving side: paste the code a friend generated from `SkillSheet`'s
 *  "Share with a friend" and install it — standing in for the group's P2P data channel until
 *  that's wired up (see `skill-share.ts`). A name collision with something already installed
 *  asks before doing anything, rather than silently picking overwrite or keep-both. */
function ImportSkillForm() {
  const tr = useTr()
  const store = useStore()
  const plugins = usePlugins(store)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<SkillPackage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const inspect = () => {
    setError(null)
    setDone(null)
    try {
      setPreview(previewSkillCode(code))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const finish = async (overwrite: boolean) => {
    if (!preview) return
    setError(null)
    try {
      const skill = await importSkillCode(store, preview, overwrite)
      setDone(skill.name)
      setPreview(null)
      setCode('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!open) {
    return (
      <Button kind="secondary" className="friends-add-button" onClick={() => setOpen(true)}>
        <HStack gap={6}><Icon name="book.pages" size={13} />{tr('Import skill code')}</HStack>
      </Button>
    )
  }

  const collision = preview ? plugins.installedSkills.find((s) => s.name === preview.name) : undefined

  return (
    <section className="friends-section friends-add-form">
      <Text as="div" size="caption" weight="semibold" tone="secondary" className="friends-section-title">{tr('Skill share code')}</Text>
      <input className="friends-code-input" value={code} placeholder={tr('Paste a skill share code')} spellCheck={false} onChange={(e) => { setCode(e.target.value); setPreview(null); setDone(null) }} />
      {done ? <Text as="div" size="caption" tone="secondary">{tr('Imported "{name}".').replaceAll('{name}', done)}</Text> : null}
      {error ? <Text as="div" tone="danger" size="caption">{error}</Text> : null}
      {preview && collision ? (
        <>
          <Text as="div" size="caption" tone="secondary">{tr('You already have a skill named "{name}".').replaceAll('{name}', preview.name)}</Text>
          <HStack gap={6}>
            <Button kind="primary" onClick={() => void finish(true)}>{tr('Overwrite')}</Button>
            <Button kind="secondary" onClick={() => void finish(false)}>{tr('Keep both')}</Button>
          </HStack>
        </>
      ) : (
        <HStack gap={6}>
          <Button kind="primary" disabled={!code.trim()} onClick={preview ? () => void finish(false) : inspect}>{preview ? tr('Import') : tr('Preview')}</Button>
          <Button kind="secondary" onClick={() => setOpen(false)}>{tr('Cancel')}</Button>
        </HStack>
      )}
    </section>
  )
}

function AddFriendForm({ myCode, onSubmit, onClose, error }: {
  myCode: string | null
  onSubmit: (code: string, name: string) => void | Promise<void>
  onClose: () => void
  error: string | null
}) {
  const tr = useTr()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [copied, setCopied] = useState(false)

  const copy = () => {
    if (!myCode) return
    void navigator.clipboard.writeText(myCode).then(() => setCopied(true))
  }

  return (
    <section className="friends-section friends-add-form">
      <Text as="div" size="caption" weight="semibold" tone="secondary" className="friends-section-title">{tr('My invite code')}</Text>
      <HStack gap={6} className="friends-code-row">
        <Text as="div" grow truncate className="friends-code-text">{myCode ?? tr('Generating…')}</Text>
        <Button kind="secondary" onClick={copy} disabled={!myCode}>{copied ? tr('Copied') : tr('Copy')}</Button>
      </HStack>

      <Text as="div" size="caption" weight="semibold" tone="secondary" className="friends-section-title">{tr("A friend's invite code")}</Text>
      <input className="friends-code-input" value={code} placeholder={tr('Paste their invite code')} spellCheck={false} onChange={(e) => setCode(e.target.value)} />
      <input className="friends-code-input" value={name} placeholder={tr('What should we call them?')} onChange={(e) => setName(e.target.value)} />
      {error ? <Text as="div" tone="danger" size="caption">{error}</Text> : null}
      <HStack gap={6}>
        <Button kind="primary" disabled={!code.trim()} onClick={() => void onSubmit(code, name)}>{tr('Send request')}</Button>
        <Button kind="secondary" onClick={onClose}>{tr('Cancel')}</Button>
      </HStack>
    </section>
  )
}

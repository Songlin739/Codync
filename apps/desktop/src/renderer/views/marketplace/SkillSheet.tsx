import { useEffect, useState } from 'react'
import { Button, CardForm, CardSection, IconButton, Spinner } from '../../components/Controls'
import { Icon } from '../../components/Icon'
import { ModalHeader, SheetPage } from '../../components/Overlay'
import { HStack } from '../../components/Stack'
import { Text } from '../../components/Text'
import { exportSkillCode } from '../../lib/skill-share.ts'
import { useStore } from '../../store/context'
import { MarkdownText } from '../thread/Markdown'
import { errorText, market } from './market-models'
import { ErrorText } from './pieces'
import { usePlugins } from './plugins'
import { useTr } from '../../lib/use-language'


/** The skill a details sheet shows: an installed one (`id`) or one from the catalog (`source`). */
export type SkillRef = { name: string; description: string } & ({ id: string; source?: never; installed?: never } | { source: string; installed?: boolean; id?: never })

/** A skill's details (kit `SkillSheet`): what it tells the bot, its `SKILL.md`, with Add while it isn't installed. */
export function SkillSheet({ skill }: { skill: SkillRef }) {
  const tr = useTr()
  const store = useStore()
  const plugins = usePlugins(store)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const which = skill.source !== undefined ? { source: skill.source } : { id: skill.id }
  const source = skill.source ?? null
  const added = source === null || skill.installed === true || plugins.installedSkills.some((s) => s.id === source.toLowerCase())

  useEffect(() => {
    let live = true
    void store
      .ready()
      .then((c) => market.skillDetails(c, which))
      .then((m) => live && setMarkdown(m), (e: unknown) => live && setError(errorText(e)))
    return () => {
      live = false
    }
  }, [])

  const add = async () => {
    if (!source) return
    setAdding(true)
    setError(null)
    try {
      await plugins.installSkill(source)
    } catch (e) {
      setError(errorText(e))
    }
    setAdding(false)
  }

  const trailing = added ? (
    <span title="Added" aria-label="Added" className="skill-added">
      <Icon name="checkmark" size={13} weight="semibold" />
    </span>
  ) : adding ? <Spinner /> : <IconButton title="Add" icon="plus" onClick={() => void add()} />

  return (
    <SheetPage>
      <ModalHeader icon="book.pages" title={skill.name} trailing={trailing} />
      <CardForm>
        {skill.description ? (
          <CardSection>
            <Text size="subheadline" tone="secondary">{skill.description}</Text>
          </CardSection>
        ) : null}
        <CardSection title="Instructions" footer={tr(added ? 'Bots read these before using the skill.' : 'Add it to let bots use these instructions.')}>
          {markdown ? <MarkdownText text={markdown} /> : markdown === '' ? <Text tone="secondary">{tr(`No instructions.`)}</Text> : error ? null : <Spinner />}
        </CardSection>
        {skill.id ? <ShareSkillSection skillId={skill.id} /> : null}
        {error ? <CardSection><ErrorText text={error} /></CardSection> : null}
      </CardForm>
    </SheetPage>
  )
}

/** 技能分享给好友: packages this installed skill into a single copyable code — the same
 *  paste-a-code flow a friend's invite code already uses — so a friend can paste it into their
 *  own "Import skill code" field (`FriendsPanel`). Standing in for the group's P2P data channel
 *  until that's wired up; see `skill-share.ts`'s own doc comment. */
function ShareSkillSection({ skillId }: { skillId: string }) {
  const tr = useTr()
  const store = useStore()
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const share = async () => {
    setLoading(true)
    setError(null)
    try {
      setCode(await exportSkillCode(store, skillId))
    } catch (e) {
      setError(errorText(e))
    }
    setLoading(false)
  }

  const copy = () => {
    if (!code) return
    void navigator.clipboard.writeText(code).then(() => setCopied(true))
  }

  return (
    <CardSection title="Share with a friend">
      {code ? (
        <HStack gap={6}>
          <Text as="div" grow truncate size="caption">{code}</Text>
          <Button kind="secondary" onClick={copy}>{copied ? tr('Copied') : tr('Copy')}</Button>
        </HStack>
      ) : (
        <Button kind="secondary" disabled={loading} onClick={() => void share()}>
          {loading ? 'Generating…' : 'Create a share code'}
        </Button>
      )}
      {error ? <ErrorText text={error} /> : null}
    </CardSection>
  )
}

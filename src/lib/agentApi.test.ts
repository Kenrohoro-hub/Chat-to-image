import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { callAgentConversationTitleApi, callAgentResponsesApi, callBatchImageSingle, parseBatchImageCallArguments } from './agentApi'

describe('parseBatchImageCallArguments', () => {
  it('trims ids and prompts, fills missing ids, and skips empty prompts', () => {
    expect(parseBatchImageCallArguments(JSON.stringify({ images: [
      { id: ' hero ', prompt: ' first prompt ' },
      { id: '   ', prompt: 'blank id' },
      { prompt: 'missing id' },
      { id: 'skipped', prompt: '   ' },
    ] }))).toEqual([
      { id: 'hero', prompt: 'first prompt' },
      { id: 'image_2', prompt: 'blank id' },
      { id: 'image_3', prompt: 'missing id' },
    ])
  })

  it('preserves per-prompt counts and rejects an invalid count instead of using defaults', () => {
    expect(parseBatchImageCallArguments(JSON.stringify({ images: [{ id: 'cat', prompt: 'a cat', n: 2 }] }))).toEqual([{ id: 'cat', prompt: 'a cat', n: 2 }])
    expect(parseBatchImageCallArguments(JSON.stringify({ images: [{ prompt: 'a cat', n: 0 }] }))).toBeNull()
  })

  it('makes duplicate and colliding ids deterministically unique', () => {
    const args = JSON.stringify({ images: [
      { id: 'same', prompt: 'one' },
      { id: ' same ', prompt: 'two' },
      { id: 'same_2', prompt: 'three' },
      { id: 'same', prompt: 'four' },
    ] })

    expect(parseBatchImageCallArguments(args)).toEqual([
      { id: 'same', prompt: 'one' },
      { id: 'same_2', prompt: 'two' },
      { id: 'same_2_2', prompt: 'three' },
      { id: 'same_3', prompt: 'four' },
    ])
    expect(parseBatchImageCallArguments(args)).toEqual(parseBatchImageCallArguments(args))
  })
})

describe('callBatchImageSingle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports the image tool error without a misleading streaming hint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Tool choice 'required' must be specified with 'tools' parameter." },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }))

    const result = await callBatchImageSingle({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses', streamImages: true }),
      params: DEFAULT_PARAMS,
      batchItemId: 'image_1',
      prompt: 'prompt',
      referenceImageDataUrls: [],
    })

    expect(result).toMatchObject({
      batchItemId: 'image_1',
      image: null,
      error: "Tool choice 'required' must be specified with 'tools' parameter.\n提示：当前使用的 API 可能未正确转发图像生成工具，请尝试更换支持该工具的接口或模型。",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('callAgentResponsesApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams Agent text without specifying an image tool model or intermediate images', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]},{"type":"image_generation_call","id":"ig_1","result":"ZmluYWw=","size":"1024x1024"}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const textDeltas: string[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      streamPartialImages: 2,
      reasoningEffort: 'xhigh',
      imageGenerationModel: 'gpt-image-2.5-flare',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onTextDelta: (delta) => textDeltas.push(delta),
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBe(true)
    expect(body).not.toHaveProperty('reasoning')
    expect(body.tools[0]).not.toHaveProperty('model')
    expect(body.tools[0]).not.toHaveProperty('partial_images')
    expect(textDeltas).toEqual(['Hel', 'lo'])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: 'Hello',
      images: [{ toolCallId: 'ig_1', dataUrl: 'data:image/png;base64,ZmluYWw=' }],
    })
  })

  it('reports failed image output item without aborting the ongoing stream', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.added","item":{"id":"ig_fail","type":"image_generation_call","status":"in_progress"},"output_index":0}',
      '',
      'data: {"type":"response.output_item.done","item":{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},"output_index":0}',
      '',
      'data: {"type":"response.output_text.delta","delta":"已跳过失败图片"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},{"type":"message","content":[{"type":"output_text","text":"已跳过失败图片"}]}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const failures: Array<{ toolCallId: string; error: string }> = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onImageToolFailed: (event) => {
        failures.push(event)
      },
    })

    expect(failures).toEqual([{ toolCallId: 'ig_fail', error: 'safety rejected' }])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: '已跳过失败图片',
      images: [],
    })
    expect(result.rawResponsePayload).toContain('resp_1')
  })

  it('exposes gallery editing and keeps mask data out of the conversation provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'edit' }] }],
      maskDataUrl: 'data:image/png;base64,bWFzaw==',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools.map((tool: { name?: string }) => tool.name)).toContain('edit_image')
    expect(JSON.stringify(body.tools)).not.toContain('input_image_mask')
    expect(body.tools[0]).toMatchObject({ type: 'function', name: 'generate_image' })
    for (const tool of body.tools.filter((tool: { name?: string }) => ['generate_image', 'edit_image', 'generate_image_batch'].includes(tool.name ?? ''))) {
      const properties = tool.name === 'generate_image_batch' ? tool.parameters.properties.images.items.properties : tool.parameters.properties
      expect(properties.n).toMatchObject({ type: 'integer', minimum: 1, maximum: 16 })
    }
    expect(body.instructions).toContain('this takes priority over the configured count')
    expect(body.instructions).toContain('three prompts with n=1')
    expect(body.instructions).toContain('Do not reuse a count from an earlier user turn')
    expect(body.instructions).not.toContain('maximum tool-use rounds')
  })

  it('requires resolution in Agent prompts and omits the Codex CLI size parameter', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      codexCli: true,
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: { ...DEFAULT_PARAMS, size: '1024x1024' },
      input: 'prompt',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools[0].size).toBeUndefined()
    expect(body.instructions).toContain('Start every image prompt with exactly "Generate at 1024x1024 resolution." followed by a space.')
  })

  it('extracts image_generation results from base64 object fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        id: 'ig_base64',
        result: { base64: 'ZmlsZQ==' },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    expect(result.images).toEqual([{
      toolCallId: 'ig_base64',
      dataUrl: 'data:image/png;base64,ZmlsZQ==',
      actualParams: {},
    }])
  })

  it('stops reading a stream when the caller aborts after output starts', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(streamBody))
        controller.close()
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const textDeltas: string[] = []
    const abortController = new AbortController()
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    await expect(callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      signal: abortController.signal,
      onTextDelta: (delta) => {
        textDeltas.push(delta)
        abortController.abort()
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(textDeltas).toEqual(['Hel'])
  })

  it('generates a short conversation title without image tools', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '<title>生成猫咪头像</title>' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      reasoningEffort: 'max',
    })

    const title = await callAgentConversationTitleApi({
      settings: DEFAULT_SETTINGS,
      profile,
      prompt: '帮我生成一张橘猫头像，要赛博朋克风格',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.instructions).toContain('<title>short title</title>')
    expect(body.reasoning).toEqual({ effort: 'max' })
    expect(body.max_output_tokens).toBeUndefined()
    expect(body.tools).toBeUndefined()
    expect(body.stream).toBeUndefined()
    expect(body.input[0].content[0].text).toContain('帮我生成一张橘猫头像，要赛博朋克风格')
    expect(title).toBe('生成猫咪头像')
  })

  it('requests web search and applies citations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_search',
      output: [
        {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: { type: 'search', query: 'OpenAI web search docs' },
        },
        {
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'See OpenAI docs.',
            annotations: [{
              type: 'url_citation',
              start_index: 4,
              end_index: 15,
              url: 'https://platform.openai.com/docs',
              title: 'OpenAI Docs',
            }],
          }],
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentWebSearch: true },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools).toEqual(expect.arrayContaining([{ type: 'web_search' }]))
    expect(result.text).toBe('See [OpenAI docs](https://platform.openai.com/docs).')
    expect(result.outputItems?.[0]).toMatchObject({ type: 'web_search_call', status: 'completed' })
  })

  it.each([
    { enabled: true, mode: 'tools' },
    { enabled: false, mode: 'tools' },
    { enabled: true, mode: 'prompt-only' },
    { enabled: false, mode: 'prompt-only' },
    { enabled: true, mode: 'unsupported-tools' },
    { enabled: false, mode: 'unsupported-tools' },
  ])('applies drawing guidance=$enabled in $mode requests without changing inputs or tool access', async ({ enabled, mode }) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Optimized prompt' }] }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key', apiMode: 'responses', model: 'chat-test',
      modelCapabilities: { 'chat-test': { vision: true, tools: mode !== 'unsupported-tools' } },
    })
    const input = [{ role: 'user', content: [
      { type: 'input_text', text: '只把外套改红，脸和背景不变' },
      { type: 'input_image', image_url: 'data:image/png;base64,bW9jaw==' },
    ] }]
    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentPromptOptimization: enabled, agentImageTools: mode !== 'prompt-only' },
      profile, params: DEFAULT_PARAMS, input,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.instructions.includes('## Drawing prompt optimization')).toBe(enabled)
    expect(body.instructions).toContain('## Math formatting')
    expect(body.input).toEqual(input)
    if (mode === 'tools') {
      expect(body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'edit_image' })]))
      expect(body.instructions).toContain('explicit instructions not to generate require text only')
    } else {
      expect(body.tools).toEqual([])
      expect(body.instructions).toContain('Image generation tools are disabled for this turn.')
    }
    if (enabled) {
      expect(body.instructions).toContain('Carry forward confirmed requirements')
      expect(body.instructions).toContain('edit target, identity, style, composition, or palette')
      expect(body.instructions).toContain('Do not generate images for a prompt-only request.')
    }
  })

  it('injects configurable math formatting instructions', async () => {
    const createResponse = () => new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createResponse())
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    let body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.instructions).toContain('## Math formatting')
    expect(body.instructions).toContain('Use `$...$` for inline formulas.')

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentMathFormattingPrompt: false },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(body.instructions).not.toContain('## Math formatting')
  })

  it("does not duplicate the assistant message item when response.completed lacks an item id", async () => {
    // `response.completed` can repeat the streamed item without id; it should merge, not append.
    const itemId = "msg_abc123"
    const streamBody = [
      `data: {"type":"response.created","response":{"id":"resp_1","output":[]}}`,
      ``,
      `data: {"type":"response.output_item.added","item":{"id":"${itemId}","type":"message","status":"in_progress","content":[],"role":"assistant"}}`,
      ``,
      `data: {"type":"response.output_text.delta","delta":"hi","item_id":"${itemId}"}`,
      ``,
      `data: {"type":"response.output_text.delta","delta":"!","item_id":"${itemId}"}`,
      ``,
      `data: {"type":"response.output_item.done","item":{"id":"${itemId}","type":"message","status":"completed","content":[{"type":"output_text","text":"hi!"}],"role":"assistant"}}`,
      ``,
      `data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi!"}]}]}}`,
      ``,
      `data: [DONE]`,
      ``,
    ].join("\n")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }))
    const outputItemSnapshots: number[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: "test-key",
      apiMode: "responses",
      streamImages: true,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
      onOutputItems: (items) => outputItemSnapshots.push(items.length),
    })

    const messageItems = (result.outputItems ?? []).filter((item) => item.type === "message")
    expect(messageItems).toHaveLength(1)
    expect(result.text).toBe("hi!")
    expect(outputItemSnapshots[outputItemSnapshots.length - 1]).toBe(1)
  })
})


describe('conversation reasoning and default image intent policy', () => {
  afterEach(() => vi.restoreAllMocks())
  it('sends conversation effort and gallery tools with explicit image intent instructions', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello' }] }] })))
    await callAgentResponsesApi({ settings: { ...DEFAULT_SETTINGS, agentReasoningEffort: 'high' }, profile: createDefaultOpenAIProfile({ apiMode: 'responses', apiKey: 'mock-key', reasoningEffort: 'low' }), params: DEFAULT_PARAMS, input: [] })
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(body.reasoning).toEqual({ effort: 'high' })
    expect(body.tools.map((tool: { name?: string }) => tool.name)).toContain('generate_image')
    expect(body.instructions).toContain('quoted requests')
    expect(body.instructions).toContain('call the appropriate gallery tool')
  })
  it('reports unsupported explicit effort before submitting a request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(callAgentResponsesApi({ settings: { ...DEFAULT_SETTINGS, agentReasoningEffort: 'high' }, profile: createDefaultOpenAIProfile({ apiMode: 'responses', model: 'chat-a', modelCapabilities: { 'chat-a': { reasoning: false } } }), params: DEFAULT_PARAMS, input: [] })).rejects.toThrow('不支持所选推理强度')
    expect(fetch).not.toHaveBeenCalled()
  })
})


it('reports an empty successful response instead of silently completing a chat turn', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output: [] })))
  try {
    await expect(callAgentResponsesApi({ settings: DEFAULT_SETTINGS, profile: createDefaultOpenAIProfile({ apiMode: 'responses' }), params: DEFAULT_PARAMS, input: [] })).rejects.toThrow('没有返回回复或图像工具调用')
  } finally { fetch.mockRestore() }
})

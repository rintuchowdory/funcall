import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Peer } from 'peerjs'
import { Phone, PhoneOff, Mic, MicOff, Copy, Check, Users, Video, VideoOff, Layers, Circle, Square } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import VoiceEffectPicker from '../components/VoiceEffectPicker'

const randomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase()

export default function FunCall() {
  const [myCode, setMyCode]           = useState('')
  const [otherCode, setOtherCode]     = useState('')
  const [inCall, setInCall]           = useState(false)
  const [callStatus, setCallStatus]   = useState('idle')
  const [isHost, setIsHost]           = useState(false)
  const [participantCount, setParticipantCount] = useState(0)
  const [isMuted, setIsMuted]         = useState(false)
  const [isVideoOn, setIsVideoOn]     = useState(false)
  const [isBgBlur, setIsBgBlur]       = useState(false)
  const [activeEffect, setActiveEffect] = useState('none')
  const activeEffectRef               = useRef('none')
  const [copied, setCopied]           = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [error, setError]             = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef              = useRef(null)
  const recordedChunksRef             = useRef([])
  const recordingTimerRef             = useRef(null)
  const peerRef                       = useRef(null)
  const callConnectionsRef            = useRef([])
  const localStreamRef                = useRef(null)
  const localVideoRef                 = useRef(null)
  const remoteVideoRefsRef            = useRef(new Map())
  const [remoteVideos, setRemoteVideos] = useState([])
  const blurCanvasRef                 = useRef(null)
  const blurAnimFrameRef              = useRef(null)
  const audioCtxRef                   = useRef(null)
  const pitchNodeRef                  = useRef(null)
  const processedStreamRef            = useRef(null)

  useEffect(() => {
    const code = randomCode()
    setMyCode(code)
    const peer = new Peer(code)
    peerRef.current = peer
    peer.on('open', () => setCallStatus('idle'))
    peer.on('error', (err) => setError(err.message))
    peer.on('call', async (call) => {
      try {
        const stream = await getLocalStream()
        const processed = buildEffectGraph(stream, activeEffectRef.current)
        processedStreamRef.current = processed
        const answerStream = new MediaStream([...processed.getAudioTracks(), ...stream.getVideoTracks()])
        call.answer(answerStream)
        attachCallHandlers(call)
        setInCall(true); setIsHost(false); setCallStatus('connected')
        setParticipantCount(n => n + 1)
      } catch (e) { console.error(e); setPermissionDenied(true) }
    })
    return () => peer.destroy()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getLocalStream = async (withVideo = false) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo })
    localStreamRef.current = stream
    if (localVideoRef.current && stream.getVideoTracks().length) localVideoRef.current.srcObject = stream
    return stream
  }

  const buildEffectGraph = useCallback((rawStream, effect) => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed')
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    const ctx = audioCtxRef.current
    if (pitchNodeRef.current) { try { pitchNodeRef.current.disconnect() } catch(_) {} }
    const source = ctx.createMediaStreamSource(rawStream)
    const dest   = ctx.createMediaStreamDestination()

    if (effect === 'none') { source.connect(dest) }
    else if (effect === 'chipmunk' || effect === 'helium' || effect === 'deep_echo') {
      const ratioMap = { chipmunk: 1.8, helium: 2.2, deep_echo: 0.55 }
      const pitchRatio = ratioMap[effect]
      const bufferSize = 4096
      const processor  = ctx.createScriptProcessor(bufferSize, 1, 1)
      const grain      = new Float32Array(bufferSize * (effect === 'deep_echo' ? 4 : 2))
      let   writePos   = 0, readPos = 0
      processor.onaudioprocess = (e) => {
        const inp = e.inputBuffer.getChannelData(0)
        const out = e.outputBuffer.getChannelData(0)
        for (let i = 0; i < bufferSize; i++) {
          grain[writePos % grain.length] = inp[i]; writePos++
          out[i] = grain[Math.floor(readPos) % grain.length]; readPos += pitchRatio
        }
      }
      source.connect(processor); processor.connect(dest)
      if (effect === 'deep_echo') {
        const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.35
        const echoGain = ctx.createGain(); echoGain.gain.value = 0.45
        processor.connect(delay); delay.connect(echoGain)
        echoGain.connect(dest);   echoGain.connect(delay)
      }
      pitchNodeRef.current = processor
    } else if (effect === 'robot') {
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 60
      const ring = ctx.createGain()
      osc.connect(ring.gain)
      const ws = ctx.createWaveShaper()
      const curve = new Float32Array(256)
      for (let i = 0; i < 256; i++) { const x = (i*2)/256-1; curve[i] = Math.tanh(x*6) }
      ws.curve = curve
      source.connect(ws); ws.connect(ring); ring.connect(dest); osc.start()
      pitchNodeRef.current = osc
    }
    return dest.stream
  }, [])

  const applyEffect = useCallback((effect) => {
    activeEffectRef.current = effect; setActiveEffect(effect)
    if (!localStreamRef.current) return
    const processed = buildEffectGraph(localStreamRef.current, effect)
    processedStreamRef.current = processed
    const newAudio = processed.getAudioTracks()[0]
    callConnectionsRef.current.forEach(call => {
      const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'audio')
      if (sender && newAudio) sender.replaceTrack(newAudio)
    })
  }, [buildEffectGraph])

  const stopBlur = useCallback(() => {
    if (blurAnimFrameRef.current) { cancelAnimationFrame(blurAnimFrameRef.current); blurAnimFrameRef.current = null }
  }, [])

  const startBlur = useCallback((videoEl) => {
    const canvas = blurCanvasRef.current
    if (!canvas || !videoEl) return null
    const ctx2 = canvas.getContext('2d')
    const draw = () => {
      if (videoEl.videoWidth) {
        canvas.width = videoEl.videoWidth; canvas.height = videoEl.videoHeight
        ctx2.filter = 'blur(20px)'; ctx2.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
        ctx2.filter = 'none'
        const [cx,cy,cw,ch] = [canvas.width*.15, canvas.height*.10, canvas.width*.70, canvas.height*.80]
        ctx2.drawImage(videoEl, cx, cy, cw, ch, cx, cy, cw, ch)
      }
      blurAnimFrameRef.current = requestAnimationFrame(draw)
    }
    draw()
    return canvas.captureStream(30)
  }, [])

  const toggleBgBlur = useCallback(() => {
    if (!isVideoOn) return
    const next = !isBgBlur; setIsBgBlur(next)
    if (next) {
      const blurStream = startBlur(localVideoRef.current)
      if (!blurStream) return
      const newTrack = blurStream.getVideoTracks()[0]
      callConnectionsRef.current.forEach(call => {
        const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video')
        if (sender && newTrack) sender.replaceTrack(newTrack)
      })
    } else {
      stopBlur()
      const origTrack = localStreamRef.current?.getVideoTracks()[0]
      if (origTrack) callConnectionsRef.current.forEach(call => {
        const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(origTrack)
      })
    }
  }, [isVideoOn, isBgBlur, startBlur, stopBlur])

  const toggleVideo = useCallback(async () => {
    const next = !isVideoOn; setIsVideoOn(next)
    if (next) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        const vTrack = stream.getVideoTracks()[0]
        localStreamRef.current.addTrack(vTrack)
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current
        callConnectionsRef.current.forEach(call => call.peerConnection?.addTrack(vTrack, localStreamRef.current))
      } catch(e) { console.error(e); setIsVideoOn(false) }
    } else { stopBlur(); setIsBgBlur(false); localStreamRef.current?.getVideoTracks().forEach(t => t.stop()) }
  }, [isVideoOn, stopBlur])

  const attachCallHandlers = (call) => {
    callConnectionsRef.current.push(call)
    call.on('stream', (remoteStream) => {
      setCallStatus('connected')
      setRemoteVideos(prev => prev.find(v => v.id === call.peer) ? prev : [...prev, { id: call.peer, stream: remoteStream }])
    })
    call.on('close', () => {
      callConnectionsRef.current = callConnectionsRef.current.filter(c => c !== call)
      setRemoteVideos(prev => prev.filter(v => v.id !== call.peer))
      setParticipantCount(n => Math.max(1, n - 1))
    })
  }

  const startCall = useCallback(async () => {
    if (!otherCode.trim()) return
    setError(''); setCallStatus('calling')
    try {
      const stream = await getLocalStream(isVideoOn)
      const processed = buildEffectGraph(stream, activeEffectRef.current)
      processedStreamRef.current = processed
      const callStream = new MediaStream([...processed.getAudioTracks(), ...stream.getVideoTracks()])
      const call = peerRef.current.call(otherCode.trim().toUpperCase(), callStream)
      attachCallHandlers(call)
      setInCall(true); setIsHost(true); setParticipantCount(2)
    } catch(e) { console.error(e); setPermissionDenied(true); setCallStatus('idle') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherCode, isVideoOn, buildEffectGraph])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop()
    clearInterval(recordingTimerRef.current); setIsRecording(false); setRecordingTime(0)
  }, [])

  const hangUp = useCallback(() => {
    stopRecording(); stopBlur()
    callConnectionsRef.current.forEach(c => c.close()); callConnectionsRef.current = []
    localStreamRef.current?.getTracks().forEach(t => t.stop()); localStreamRef.current = null
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null }
    setInCall(false); setCallStatus('idle'); setIsVideoOn(false); setIsBgBlur(false)
    setActiveEffect('none'); activeEffectRef.current = 'none'
    setRemoteVideos([]); setParticipantCount(0); setIsHost(false)
  }, [stopBlur, stopRecording])

  const toggleMute = useCallback(() => {
    const next = !isMuted; setIsMuted(next)
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
  }, [isMuted])

  const startRecording = useCallback(() => {
    if (!processedStreamRef.current) return
    recordedChunksRef.current = []
    const recStream = new MediaStream([
      ...processedStreamRef.current.getAudioTracks(),
      ...(localStreamRef.current?.getVideoTracks() ?? []),
    ])
    const mr = new MediaRecorder(recStream, { mimeType: 'video/webm;codecs=vp8,opus' })
    mr.ondataavailable = e => { if (e.data.size > 0) recordedChunksRef.current.push(e.data) }
    mr.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' })
      const url  = URL.createObjectURL(blob)
      const a    = Object.assign(document.createElement('a'), { href: url, download: `funcall-${Date.now()}.webm` })
      a.click(); URL.revokeObjectURL(url)
    }
    mr.start(1000); mediaRecorderRef.current = mr; setIsRecording(true); setRecordingTime(0)
    recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000)
  }, [])

  const toggleRecording = useCallback(() => { isRecording ? stopRecording() : startRecording() }, [isRecording, startRecording, stopRecording])
  const copyCode = () => { navigator.clipboard.writeText(myCode); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  const setRemoteVideoRef = (id, el) => {
    if (el) {
      remoteVideoRefsRef.current.set(id, el)
      const vid = remoteVideos.find(v => v.id === id)
      if (vid) el.srcObject = vid.stream
    }
  }
  const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <canvas ref={blurCanvasRef} className="hidden" />
      <motion.div initial={{ opacity:0, y:24 }} animate={{ opacity:1, y:0 }} className="w-full max-w-md">
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl space-y-6">

          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">🎙️ FunCall</h1>
            <p className="text-[#DCE7FF]/60 text-xs">Peer-to-peer calls with voice effects</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-[#DCE7FF]/60 text-xs font-medium uppercase tracking-wider">Your Code</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white font-mono text-lg tracking-widest text-center select-all">{myCode}</div>
              <Button variant="outline" size="icon" onClick={copyCode} className="shrink-0">
                {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
              </Button>
            </div>
          </div>

          <AnimatePresence>
            {permissionDenied && (
              <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
                className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 text-red-300 text-xs text-center">
                🚫 Microphone / camera access denied.
              </motion.div>
            )}
            {error && (
              <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
                className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 text-red-300 text-xs text-center">
                ⚠️ {error}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {!inCall ? (
              <motion.div key="pre" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-3">
                <div className="space-y-1.5">
                  <p className="text-[#DCE7FF]/60 text-xs font-medium uppercase tracking-wider">Friend's Code</p>
                  <Input value={otherCode} onChange={e => setOtherCode(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key==='Enter' && startCall()} placeholder="XXXXXX"
                    maxLength={10} className="font-mono tracking-widest text-center text-lg" />
                </div>
                <Button onClick={startCall} disabled={!otherCode.trim() || callStatus==='calling'} className="w-full bg-purple-600 hover:bg-purple-500">
                  {callStatus==='calling' ? <span className="animate-pulse">Calling…</span> : <><Phone size={16}/> Call</>}
                </Button>
              </motion.div>
            ) : (
              <motion.div key="incall" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="space-y-5">
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
                    ${callStatus==='connected' ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 animate-pulse'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${callStatus==='connected' ? 'bg-green-400':'bg-yellow-400'}`} />
                    {callStatus==='connected' ? 'Connected' : 'Connecting…'}
                  </span>
                  {isHost && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      <Users size={11}/> {participantCount} in call
                    </span>
                  )}
                  {isRecording && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30 animate-pulse">
                      <Circle size={10} className="fill-red-400 text-red-400"/> REC {fmtTime(recordingTime)}
                    </span>
                  )}
                </div>

                {(isVideoOn || remoteVideos.length > 0) && (
                  <div className="grid grid-cols-2 gap-2">
                    {isVideoOn && (
                      <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                        <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover mirror"/>
                        <span className="absolute bottom-1 left-2 text-[10px] text-white/70">You</span>
                        {isBgBlur && <span className="absolute top-1 right-1 text-[10px] bg-black/50 text-white px-1.5 py-0.5 rounded">blur</span>}
                      </div>
                    )}
                    {remoteVideos.map(v => (
                      <div key={v.id} className="relative rounded-xl overflow-hidden bg-black aspect-video">
                        <video ref={el => setRemoteVideoRef(v.id, el)} autoPlay playsInline className="w-full h-full object-cover"/>
                        <span className="absolute bottom-1 left-2 text-[10px] text-white/70">{v.id}</span>
                      </div>
                    ))}
                  </div>
                )}

                <VoiceEffectPicker activeEffect={activeEffect} onSelect={applyEffect}/>

                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <Button variant="outline" size="icon" onClick={toggleMute} className={isMuted?'border-red-500/50 bg-red-500/20 text-red-300':''}>
                    {isMuted ? <MicOff size={18}/> : <Mic size={18}/>}
                  </Button>
                  <Button variant="outline" size="icon" onClick={toggleVideo} className={isVideoOn?'border-purple-400/50 bg-purple-500/20 text-purple-300':''}>
                    {isVideoOn ? <Video size={18}/> : <VideoOff size={18}/>}
                  </Button>
                  <AnimatePresence>
                    {isVideoOn && (
                      <motion.div initial={{scale:0}} animate={{scale:1}} exit={{scale:0}}>
                        <Button variant="outline" size="icon" onClick={toggleBgBlur} className={isBgBlur?'border-blue-400/50 bg-blue-500/20 text-blue-300':''}>
                          <Layers size={18}/>
                        </Button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {isHost && (
                    <Button variant="outline" size="icon" onClick={toggleRecording} className={isRecording?'border-red-500/50 bg-red-500/20 text-red-300 animate-pulse':''}>
                      {isRecording ? <Square size={18}/> : <Circle size={18}/>}
                    </Button>
                  )}
                  <Button onClick={hangUp} className="bg-red-600 hover:bg-red-500 px-5">
                    <PhoneOff size={18}/>
                  </Button>
                </div>

                <p className="text-center text-[#DCE7FF]/60 text-xs">
                  {isMuted ? '🔇 Microphone muted' : `🎙️ Effect: ${activeEffect==='none'?'Normal':activeEffect.replace('_',' ')}`}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
        <p className="text-center text-white/20 text-xs mt-4">Share your code — no servers, peer-to-peer only</p>
      </motion.div>
    </div>
  )
}

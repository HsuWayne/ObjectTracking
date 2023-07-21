import { useRef, useState, useEffect } from 'react'
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg'
import { v4 as uuidv4 } from 'uuid'
import { Rnd } from 'react-rnd'
import {
  Layout,
  Col,
  Row,
  Button,
  message,
  Upload,
  Progress,
  Space,
  Select
} from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import amb from './assets/images/icon/amb.png'

declare global {
  interface Window {
    cv: any
    onOpenCvReady: () => void
  }
}

interface Box {
  position: number[]
  color: number[]
  label: string
  uuid: string
}

interface Frame {
  imagePath: string
  box: Box[]
}

interface DrawingBox {
  x: number
  y: number
  width: number
  height: number
}

interface LabelConstant {
  color: number[]
  label: string
  uuid: string
}

enum DeleteLabelType {
  All,
  Before,
  After
}

const App = () => {
  const { Header, Content } = Layout
  const [frames, setFrames] = useState<Frame[]>([])
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number>(0)
  const [selectedLabel, setSelectedLabel] = useState<Box[]>([])
  const [renderSelectedLabel, setRenderSelectedLabel] = useState<Box[]>([])
  const [loading, setLoading] = useState<number | null>(null)
  const [isTracking, setIsTracking] = useState<boolean>(false)
  const [isMultiSelectingLabel, setIsMultiSelectingLabel] =
    useState<boolean>(false)
  const [isSingleSelectingLabel, setIsSingleSelectingLabel] =
    useState<boolean>(false)
  const [frameSize, setFrameSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [drawingBox, setDrawingBox] = useState<DrawingBox | null>(null)
  const [labelConstant, setLabelConstant] = useState<LabelConstant | null>(null)
  const intervalRef = useRef<any>(null)

  const ffmpeg = useRef<any>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const canvasBoxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackWindow = useRef<any>(null)
  const roiHist = useRef<any>(null)

  const convertVideoToImages = async (
    videoFile: any,
    videoFileName: string
  ) => {
    try {
      if (!ffmpeg.current) {
        ffmpeg.current = createFFmpeg()
        await ffmpeg.current.load()
      }

      // 讀取影片
      ffmpeg.current.FS('writeFile', videoFileName, await fetchFile(videoFile))

      // 創建一個輸出目錄
      ffmpeg.current.FS('mkdir', 'output')

      ffmpeg.current.setProgress(({ ratio }: { ratio: number }) => {
        const percentage: number = parseFloat((ratio * 100).toFixed(2))
        setLoading(percentage)
        /*
         * Ratio is a float number between 0 to 1.
         */
      })

      // 用FFmpeg將影片轉成圖片序列
      await ffmpeg.current.run(
        '-i',
        videoFileName,
        '-vf',
        'fps=30',
        'output/image%d.png'
      )

      console.log('Video converted to image sequence successfully.')

      // 取得已轉換的圖片序列
      const files = ffmpeg.current.FS('readdir', 'output')
      const imageFiles = files.filter((file: string) => file.endsWith('.png'))
      const imagePaths = imageFiles.map((file: string) => {
        const fileData = ffmpeg.current.FS('readFile', `output/${file}`)
        const blob = new Blob([fileData.buffer], { type: 'image/png' })
        return URL.createObjectURL(blob)
      })

      // 在影片轉換完成後更新 canvas 的大小
      const loadImage = (src: string) => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.onerror = () => reject(new Error('Failed to load image.'))
          image.src = src
        })
      }
      const image = await loadImage(imagePaths[0])
      const { width, height } = image
      const windowDiv = windowRef.current
      const canvasBox = canvasBoxRef.current
      const canvas = canvasRef.current
      if (windowDiv && canvasBox && canvas) {
        const videoAspectRatio = width / height
        const windowAspectRatio = windowDiv.clientWidth / windowDiv.clientHeight
        let maxBoxWidth
        let maxBoxHeight
        if (videoAspectRatio > windowAspectRatio) {
          // 影片的寬高比較大，以高度為基準，計算最大寬度
          maxBoxHeight = windowDiv.clientHeight
          maxBoxWidth = maxBoxHeight * videoAspectRatio
        } else {
          // 影片的寬高比較小，以寬度為基準，計算最大高度
          maxBoxWidth = windowDiv.clientWidth
          maxBoxHeight = maxBoxWidth / videoAspectRatio
        }
        // 計算實際使用的寬高
        let boxWidth = maxBoxWidth
        let boxHeight = maxBoxHeight
        if (boxWidth > windowDiv.clientWidth) {
          boxWidth = windowDiv.clientWidth
          boxHeight = boxWidth / videoAspectRatio
        }
        if (boxHeight > windowDiv.clientHeight) {
          boxHeight = windowDiv.clientHeight
          boxWidth = boxHeight * videoAspectRatio
        }
        // 設定 canvasBox 及 canvas 的大小
        canvasBox.style.width = `${boxWidth}px`
        canvasBox.style.height = `${boxHeight}px`
        canvas.width = boxWidth
        canvas.height = boxHeight
        setFrameSize({ width: boxWidth, height: boxHeight })
      }

      // 初始化frames
      const frameData = imagePaths.map((imagePath: any) => ({
        imagePath,
        box: []
      }))
      setFrames(frameData)
      ffmpeg.current = null
      setLoading(null)
      message.success(
        `${videoFileName} converted to image sequence successfully.`
      )
    } catch (error) {
      console.error('Failed to convert video: ', error)
    }
  }

  const handleFileChange = (videoFile: any) => {
    const videoFileName = videoFile.name
    convertVideoToImages(videoFile, videoFileName)
    // 停止antd上傳影片的request
    return false
  }

  const handleCanvasMouseDown = (
    event: React.MouseEvent<HTMLCanvasElement>
  ) => {
    const { offsetX, offsetY } = event.nativeEvent

    if (labelConstant || isMultiSelectingLabel) {
      setDrawingBox({
        x: offsetX,
        y: offsetY,
        width: 0,
        height: 0
      })
    }
  }

  const handleCanvasMouseMove = (
    event: React.MouseEvent<HTMLCanvasElement>
  ) => {
    if ((labelConstant || isMultiSelectingLabel) && drawingBox) {
      const { offsetX, offsetY } = event.nativeEvent

      setDrawingBox((prevDrawingBox) => {
        if (prevDrawingBox) {
          const width = offsetX - prevDrawingBox.x
          const height = offsetY - prevDrawingBox.y
          return {
            ...prevDrawingBox,
            width,
            height
          }
        }
        return null
      })
    }
  }

  const handleCanvasMouseUp = () => {
    if (labelConstant && drawingBox) {
      singleLabel(drawingBox, labelConstant)
      setDrawingBox(null)
      setLabelConstant(null)
    }
    if (isMultiSelectingLabel && drawingBox && frameSize) {
      // 輸出框選範圍內的frame.box資訊
      const selectedBoxes = frames[selectedFrameIndex].box.filter((box) => {
        const [x, y, w, h] = box.position
        const boxRight = (x + w) * frameSize.width
        const boxBottom = (y + h) * frameSize.height
        const selectedRight = drawingBox.x + drawingBox.width
        const selectedBottom = drawingBox.y + drawingBox.height
        return (
          x * frameSize.width >= drawingBox.x &&
          y * frameSize.height >= drawingBox.y &&
          boxRight <= selectedRight &&
          boxBottom <= selectedBottom
        )
      })
      // 將不重複的 box 添加到 selectedLabel
      const updatedSelectedLabel = [...selectedLabel]
      selectedBoxes.forEach((box) => {
        const isBoxDuplicate = selectedLabel.some(
          (selectedBox) => selectedBox.uuid === box.uuid
        )
        if (!isBoxDuplicate) {
          updatedSelectedLabel.push(box)
        }
      })
      setSelectedLabel(updatedSelectedLabel)
      setDrawingBox(null)
      setIsMultiSelectingLabel(false)
    }
  }

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isSingleSelectingLabel && frameSize) {
      const { offsetX, offsetY } = event.nativeEvent
      const selectedBox = frames[selectedFrameIndex].box.find((box) => {
        const [x, y, w, h] = box.position
        const boxRight = (x + w) * frameSize.width
        const boxBottom = (y + h) * frameSize.height
        return (
          offsetX >= x * frameSize.width &&
          offsetX <= boxRight &&
          offsetY >= y * frameSize.height &&
          offsetY <= boxBottom
        )
      })
      if (selectedBox) {
        setSelectedLabel((prevSelectedLabel) => [
          ...prevSelectedLabel,
          selectedBox
        ])
      }
      setIsSingleSelectingLabel(false)
    }
  }

  const handleRndDragStop = (
    boxId: string,
    newPosition: { x: number; y: number }
  ) => {
    if (frameSize) {
      // 更新框的位置
      const updatedRenderSelectedLabel = renderSelectedLabel.map((box) => {
        if (box.uuid === boxId) {
          return {
            ...box,
            position: [
              newPosition.x / frameSize.width,
              newPosition.y / frameSize.height,
              box.position[2],
              box.position[3]
            ]
          }
        }
        return box
      })
      setRenderSelectedLabel(updatedRenderSelectedLabel)
      // 更新 frames 中對應的框的位置
      const updatedFrames = frames.map((frame, index) => {
        if (index === selectedFrameIndex) {
          const updatedBox = frame.box.map((box) => {
            if (box.uuid === boxId) {
              return {
                ...box,
                position: [
                  newPosition.x / frameSize.width,
                  newPosition.y / frameSize.height,
                  box.position[2],
                  box.position[3]
                ]
              }
            }
            return box
          })
          return { ...frame, box: updatedBox }
        }
        return frame
      })
      setFrames(updatedFrames)
    }
  }

  const handleRndResizeStop = (
    boxId: string,
    newSize: { offsetWidth: number; offsetHeight: number },
    newPosition: { x: number; y: number }
  ) => {
    if (frameSize) {
      // 更新框的大小
      const updatedRenderSelectedLabel = renderSelectedLabel.map((box) => {
        if (box.uuid === boxId) {
          return {
            ...box,
            position: [
              newPosition.x / frameSize.width,
              newPosition.y / frameSize.height,
              newSize.offsetWidth / frameSize.width,
              newSize.offsetHeight / frameSize.height
            ]
          }
        }
        return box
      })
      setRenderSelectedLabel(updatedRenderSelectedLabel)
      // 更新 frames 中對應的框的大小
      const updatedFrames = frames.map((frame, index) => {
        if (index === selectedFrameIndex) {
          const updatedBox = frame.box.map((box) => {
            if (box.uuid === boxId) {
              return {
                ...box,
                position: [
                  newPosition.x / frameSize.width,
                  newPosition.y / frameSize.height,
                  newSize.offsetWidth / frameSize.width,
                  newSize.offsetHeight / frameSize.height
                ]
              }
            }
            return box
          })
          return { ...frame, box: updatedBox }
        }
        return frame
      })
      setFrames(updatedFrames)
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) {
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context && frames.length > 0) {
        const { imagePath, box } = frames[selectedFrameIndex]
        const image = new Image()
        image.src = imagePath
        image.onload = () => {
          // 繪製影像
          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(image, 0, 0, canvas.width, canvas.height)

          // 繪製不在selectedLabel的label框, 並將在selectedLabel的框加入RenderSelectedLabel
          const newRenderSelectedLabel: Box[] = []
          box.forEach(({ position, color, label, uuid }) => {
            const [x, y, w, h] = position
            const [r, g, b, a] = color
            // 檢查 box 是否存在於 selectedLabel
            const isSelected = selectedLabel.some((box) => box.uuid === uuid)
            if (isSelected) {
              newRenderSelectedLabel.push({ position, color, label, uuid })
            } else if (frameSize) {
              context.strokeStyle = `rgba(${r},${g},${b},${a})`
              context.lineWidth = 2
              context.strokeRect(
                x * frameSize.width,
                y * frameSize.height,
                w * frameSize.width,
                h * frameSize.height
              )
            }
          })

          setRenderSelectedLabel(newRenderSelectedLabel)

          // 畫出正在Label的範圍框
          if (labelConstant && drawingBox) {
            const [r, g, b, a] = labelConstant.color
            context.strokeStyle = `rgba(${r},${g},${b},${a})`
            context.lineWidth = 2
            context.strokeRect(
              drawingBox.x,
              drawingBox.y,
              drawingBox.width,
              drawingBox.height
            )
          }

          // 畫出正在MultiSelectingLabel的範圍框
          if (isMultiSelectingLabel && drawingBox) {
            context.strokeStyle = 'rgba(255, 255, 255, 1)'
            context.lineWidth = 1
            context.strokeRect(
              drawingBox.x,
              drawingBox.y,
              drawingBox.width,
              drawingBox.height
            )
          }
        }
      }
    }
  }, [
    drawingBox,
    frames,
    selectedFrameIndex,
    labelConstant,
    isMultiSelectingLabel,
    selectedLabel,
    frameSize
  ])

  useEffect(() => {
    const setCursorStyle = () => {
      if (labelConstant) {
        document.body.style.cursor = 'crosshair'
      } else {
        document.body.style.cursor = 'auto'
      }
    }

    window.addEventListener('mousemove', setCursorStyle)

    return () => {
      window.removeEventListener('mousemove', setCursorStyle)
    }
  }, [labelConstant])

  const startTracking = () => {
    const canvas = canvasRef.current
    // 將存在於 selectedLabel 的框加入 trackWindow 追蹤清單
    const traceBoxDetail = frames[selectedFrameIndex].box.filter((box) =>
      selectedLabel.some((selected) => selected.uuid === box.uuid)
    )
    // Setup the termination criteria, either 10 iteration or move by at least 1 pt
    const termCrit = new window.cv.TermCriteria(
      window.cv.TERM_CRITERIA_EPS | window.cv.TERM_CRITERIA_COUNT,
      10,
      1
    )
    let hsv: any
    const dst = new window.cv.Mat()
    const hsvVec = new window.cv.MatVector()
    if (window.cv && canvas && traceBoxDetail.length > 0 && frameSize) {
      trackWindow.current = traceBoxDetail.map((boxData) => {
        const [x, y, w, h] = boxData.position
        return new window.cv.Rect(
          x * frameSize.width,
          y * frameSize.height,
          w * frameSize.width,
          h * frameSize.height
        )
      })
      roiHist.current = null

      const { imagePath, box } = frames[selectedFrameIndex]
      const image = new Image()
      image.src = imagePath
      image.onload = () => {
        const context = canvas.getContext('2d')
        if (context) {
          // 繪製影像
          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          // 繪製不在selectedLabel的label框
          box.forEach(({ position, color, uuid }) => {
            const [x, y, w, h] = position
            const [r, g, b, a] = color
            // 檢查 box 是否存在於 selectedLabel
            const isSelected = selectedLabel.some((box) => box.uuid === uuid)
            if (!isSelected) {
              context.strokeStyle = `rgba(${r},${g},${b},${a})`
              context.lineWidth = 2
              context.strokeRect(
                x * frameSize.width,
                y * frameSize.height,
                w * frameSize.width,
                h * frameSize.height
              )
            }
          })

          const frame = window.cv.imread(canvas)
          hsv = new window.cv.Mat(frame.rows, frame.cols, window.cv.CV_8UC3)
          hsvVec.push_back(hsv)
          roiHist.current = trackWindow.current.map((trackWindow: any) => {
            // set up the ROI for tracking
            const roi = frame.roi(trackWindow)
            const hsvRoi = new window.cv.Mat()
            window.cv.cvtColor(roi, hsvRoi, window.cv.COLOR_RGBA2RGB)
            window.cv.cvtColor(hsvRoi, hsvRoi, window.cv.COLOR_RGB2HSV)
            const mask = new window.cv.Mat()
            const lowScalar = new window.cv.Scalar(30, 30, 0)
            const highScalar = new window.cv.Scalar(180, 180, 180)
            const low = new window.cv.Mat(
              hsvRoi.rows,
              hsvRoi.cols,
              hsvRoi.type(),
              lowScalar
            )
            const high = new window.cv.Mat(
              hsvRoi.rows,
              hsvRoi.cols,
              hsvRoi.type(),
              highScalar
            )
            window.cv.inRange(hsvRoi, low, high, mask)
            const roiHist = new window.cv.Mat()
            const hsvRoiVec = new window.cv.MatVector()
            hsvRoiVec.push_back(hsvRoi)
            window.cv.calcHist(hsvRoiVec, [0], mask, roiHist, [180], [0, 180])
            window.cv.normalize(roiHist, roiHist, 0, 255, window.cv.NORM_MINMAX)
            // delete useless mats
            roi.delete()
            hsvRoi.delete()
            mask.delete()
            low.delete()
            high.delete()
            hsvRoiVec.delete()
            return roiHist
          })
        }
      }

      const processImage = (
        imageData: Frame,
        labelIndex: number
      ): Promise<Box> => {
        return new Promise((resolve) => {
          const { imagePath, box } = imageData
          const image = new Image()
          image.src = imagePath

          image.onload = () => {
            const context = canvas.getContext('2d')
            if (context) {
              // 繪製影像
              context.clearRect(0, 0, canvas.width, canvas.height)
              context.drawImage(image, 0, 0, canvas.width, canvas.height)
              // 繪製不在selectedLabel的label框
              box.forEach(({ position, color, uuid }) => {
                const [x, y, w, h] = position
                const [r, g, b, a] = color
                // 檢查 box 是否存在於 selectedLabel
                const isSelected = selectedLabel.some(
                  (box) => box.uuid === uuid
                )
                if (!isSelected && frameSize) {
                  context.strokeStyle = `rgba(${r},${g},${b},${a})`
                  context.lineWidth = 2
                  context.strokeRect(
                    x * frameSize.width,
                    y * frameSize.height,
                    w * frameSize.width,
                    h * frameSize.height
                  )
                }
              })

              const frame = window.cv.imread(canvas)
              // start processing.
              window.cv.cvtColor(frame, hsv, window.cv.COLOR_RGBA2RGB)
              window.cv.cvtColor(hsv, hsv, window.cv.COLOR_RGB2HSV)
              window.cv.calcBackProject(
                hsvVec,
                [0],
                roiHist.current[labelIndex],
                dst,
                [0, 180],
                1
              )
              // Apply meanshift to get the new location
              const [, newTrackWindow] = window.cv.meanShift(
                dst,
                trackWindow.current[labelIndex],
                termCrit
              )
              trackWindow.current[labelIndex] = newTrackWindow

              frame.delete()

              resolve({
                label: traceBoxDetail[labelIndex].label,
                position: [
                  trackWindow.current[labelIndex].x / frameSize.width,
                  trackWindow.current[labelIndex].y / frameSize.height,
                  trackWindow.current[labelIndex].width / frameSize.width,
                  trackWindow.current[labelIndex].height / frameSize.height
                ],
                color: traceBoxDetail[labelIndex].color,
                uuid: traceBoxDetail[labelIndex].uuid
              })
            }
          }
        })
      }
      // 從現在圖片的下一幀開始tracking
      let currentFrameIndex = selectedFrameIndex + 1
      setIsTracking(true)
      intervalRef.current = setInterval(() => {
        if (currentFrameIndex >= frames.length) {
          // 已經處理完所有 frames，停止迴圈
          dst.delete()
          hsvVec.delete()
          roiHist.current = null
          hsv.delete()
          stopProcessing()
          return
        }

        const processImagePromises = []
        for (
          let currentLabelIndex = 0;
          currentLabelIndex < trackWindow.current.length;
          currentLabelIndex++
        ) {
          processImagePromises.push(
            processImage(frames[currentFrameIndex], currentLabelIndex)
          )
        }
        Promise.all(processImagePromises).then((res: Box[]) => {
          // 將 tracking 結果更新
          const updatedFrames = [...frames]
          res.forEach((box) => {
            // 檢查 updatedFrames[currentFrameIndex].box 中是否已存在相同 uuid 的項目
            const existingBoxIndex = updatedFrames[
              currentFrameIndex
            ].box.findIndex((existingBox) => existingBox.uuid === box.uuid)
            if (existingBoxIndex !== -1) {
              // 如果已存在相同 uuid 的項目，則更新該項目
              updatedFrames[currentFrameIndex].box[existingBoxIndex] = box
            } else {
              // 如果不存在相同 uuid 的項目，則新增該項目
              updatedFrames[currentFrameIndex].box.push(box)
            }
          })
          setFrames(updatedFrames)
          setSelectedFrameIndex(currentFrameIndex)
          currentFrameIndex++
        })
      }, 250)
    }
  }

  const stopProcessing = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
      setIsTracking(false)
    }
  }

  const singleLabel = (
    drawingBox: DrawingBox,
    labelConstant: LabelConstant
  ) => {
    if (frameSize) {
      const updatedBox = [...frames[selectedFrameIndex].box]
      // 添加一個帶有標籤、位置、顏色和id的新box
      updatedBox.push({
        label: labelConstant.label,
        position: [
          drawingBox.x / frameSize.width,
          drawingBox.y / frameSize.height,
          drawingBox.width / frameSize.width,
          drawingBox.height / frameSize.height
        ],
        color: labelConstant.color,
        uuid: labelConstant.uuid
      })

      // Update framesData
      setFrames((prevFrames) => {
        const updatedFrames = [...prevFrames]
        updatedFrames[selectedFrameIndex] = {
          ...frames[selectedFrameIndex],
          box: updatedBox
        }
        return updatedFrames
      })
    }
  }

  const handlePreviousFrame = () => {
    setSelectedFrameIndex((prevIndex) => Math.max(0, prevIndex - 1))
  }

  const handleNextFrame = () => {
    setSelectedFrameIndex((prevIndex) =>
      Math.min(frames.length - 1, prevIndex + 1)
    )
  }

  const handleDeleteLabel = (deleteType: DeleteLabelType) => {
    switch (deleteType) {
      case DeleteLabelType.All:
        setFrames((prevFrames) => {
          const updatedFrames = prevFrames.map((frame) => ({
            ...frame,
            box: frame.box.filter((box) => {
              // 只保留不在 selectedLabel 中的框
              return !selectedLabel.some(
                (selectedBox) => selectedBox.uuid === box.uuid
              )
            })
          }))
          return updatedFrames
        })
        setSelectedLabel([]) // 清空 selectedLabel
        break
      case DeleteLabelType.Before:
        setFrames((prevFrames) => {
          const updatedFrames = prevFrames.map((frame, index) => {
            if (index <= selectedFrameIndex) {
              // 刪除在 selectedFrameIndex 之前且在 selectedLabel 中的框
              return {
                ...frame,
                box: frame.box.filter((box) => {
                  return !selectedLabel.some(
                    (selectedBox) => selectedBox.uuid === box.uuid
                  )
                })
              }
            }
            return frame
          })
          return updatedFrames
        })
        setSelectedLabel([]) // 清空 selectedLabel
        break
      case DeleteLabelType.After:
        setFrames((prevFrames) => {
          const updatedFrames = prevFrames.map((frame, index) => {
            if (index >= selectedFrameIndex) {
              // 刪除在 selectedFrameIndex 之後且在 selectedLabel 中的框
              return {
                ...frame,
                box: frame.box.filter((box) => {
                  return !selectedLabel.some(
                    (selectedBox) => selectedBox.uuid === box.uuid
                  )
                })
              }
            }
            return frame
          })
          return updatedFrames
        })
        setSelectedLabel([]) // 清空 selectedLabel
        break
      default:
        break
    }
  }

  return (
    <Layout
      style={{
        backgroundColor: '#fff'
      }}
    >
      <Header
        style={{
          color: '#000',
          height: 80,
          lineHeight: '80px',
          backgroundColor: 'rgba(255, 193, 7, 0.4)',
          fontSize: 40,
          boxShadow: '0 1px 2px 0 rgba(255, 193, 7, 1)',
          marginBottom: 40
        }}
      >
        Object Tracking
      </Header>
      <Content style={{ paddingLeft: 16, paddingRight: 16 }}>
        <Row
          gutter={16}
          style={{
            minHeight: '80vh',
            lineHeight: '16px',
            fontSize: 16
          }}
        >
          <Col span={6}>
            <div
              style={{
                textAlign: 'center',
                borderRadius: 16,
                border: '1px solid #888',
                backgroundColor: '#EEEEEE',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%'
              }}
            >
              <Upload
                accept='video/*'
                showUploadList={{
                  showRemoveIcon: false
                }}
                maxCount={1}
                beforeUpload={handleFileChange}
              >
                <Button icon={<UploadOutlined />}>Click to Upload Video</Button>
                {loading ? <Progress percent={loading} /> : null}
              </Upload>
            </div>
          </Col>
          <Col span={12}>
            <div
              style={{
                backgroundColor: '#000',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%'
              }}
              ref={windowRef}
            >
              <div ref={canvasBoxRef}>
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onClick={handleCanvasClick}
                />
                {renderSelectedLabel.map((box) => (
                  <Rnd
                    key={box.uuid}
                    style={{
                      border: `dashed 2px rgba(${box.color.join(',')})`
                    }}
                    size={{
                      width: frameSize ? box.position[2] * frameSize.width : 0,
                      height: frameSize ? box.position[3] * frameSize.height : 0
                    }}
                    position={{
                      x: frameSize ? box.position[0] * frameSize.width : 0,
                      y: frameSize ? box.position[1] * frameSize.height : 0
                    }}
                    onDragStop={(e, d) =>
                      handleRndDragStop(box.uuid, { x: d.x, y: d.y })
                    }
                    onResizeStop={(e, direction, ref, delta, position) =>
                      handleRndResizeStop(box.uuid, ref, position)
                    }
                    bounds='parent'
                  ></Rnd>
                ))}
              </div>
            </div>
          </Col>
          <Col span={6}>
            <div
              style={{
                minHeight: '20vh',
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 16,
                border: '1px solid #888',
                backgroundColor: '#EEEEEE',
                marginBottom: 16
              }}
            >
              <div>
                <p>繪製label</p>
                <Space style={{ flexWrap: 'wrap' }}>
                  <Button
                    onClick={() => {
                      setLabelConstant({
                        color: [255, 0, 0, 255],
                        label: 'label1',
                        uuid: uuidv4()
                      })
                    }}
                    type='primary'
                    disabled={frames.length === 0}
                  >
                    Label1
                  </Button>
                  <Button
                    onClick={() => {
                      setLabelConstant({
                        color: [0, 255, 0, 255],
                        label: 'label2',
                        uuid: uuidv4()
                      })
                    }}
                    type='primary'
                    disabled={frames.length === 0}
                  >
                    Label2
                  </Button>
                  <Button
                    onClick={() => {
                      setLabelConstant(null)
                    }}
                    type='primary'
                    disabled={!labelConstant}
                  >
                    取消繪製label
                  </Button>
                </Space>
              </div>
            </div>
            <div
              style={{
                minHeight: '20vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 16,
                border: '1px solid #888',
                backgroundColor: '#EEEEEE',
                marginBottom: 16
              }}
            >
              <div>
                <p>選取label</p>
                <Space style={{ flexWrap: 'wrap' }}>
                  <Button
                    onClick={() => {
                      setIsMultiSelectingLabel(true)
                    }}
                    type='primary'
                    disabled={frames.length === 0}
                  >
                    多選label
                  </Button>
                  <Button
                    onClick={() => {
                      setIsSingleSelectingLabel(true)
                    }}
                    type='primary'
                    disabled={frames.length === 0}
                  >
                    單選label
                  </Button>
                  <Button
                    onClick={() => {
                      setSelectedLabel([])
                    }}
                    type='primary'
                    disabled={selectedLabel.length === 0}
                  >
                    取消選取label
                  </Button>
                </Space>
              </div>
            </div>
            <div
              style={{
                minHeight: '20vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 16,
                border: '1px solid #888',
                backgroundColor: '#EEEEEE',
                marginBottom: 16
              }}
            >
              <div>
                <p>切換幀及追蹤</p>
                <Space direction='vertical'>
                  <Space style={{ flexWrap: 'wrap' }}>
                    <Select
                      value={selectedFrameIndex}
                      onChange={(value) => setSelectedFrameIndex(value)}
                      options={frames.map((_, index) => ({
                        key: index,
                        value: index,
                        label: `Frame${index + 1}`
                      }))}
                      style={{ minWidth: 100 }}
                    />
                    <Button
                      onClick={handlePreviousFrame}
                      disabled={selectedFrameIndex === 0 || frames.length === 0}
                      type='primary'
                    >
                      前一幀
                    </Button>
                    <Button
                      onClick={handleNextFrame}
                      disabled={
                        selectedFrameIndex === frames.length - 1 ||
                        frames.length === 0
                      }
                      type='primary'
                    >
                      下一幀
                    </Button>
                  </Space>
                  <Space style={{ flexWrap: 'wrap' }}>
                    <Button
                      onClick={() => {
                        console.log(frames)
                        if (selectedFrameIndex + 1 < frames.length)
                          startTracking()
                      }}
                      disabled={isTracking || selectedLabel.length === 0}
                      type='primary'
                    >
                      開始追蹤
                    </Button>
                    <Button
                      onClick={() => {
                        stopProcessing()
                      }}
                      type='primary'
                      disabled={!isTracking}
                    >
                      停止追蹤
                    </Button>
                  </Space>
                </Space>
              </div>
            </div>
            <div
              style={{
                minHeight: '20vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 16,
                border: '1px solid #888',
                backgroundColor: '#EEEEEE'
              }}
            >
              <div>
                <p>刪除選取中label</p>
                <Space style={{ flexWrap: 'wrap' }}>
                  <Button
                    onClick={() => handleDeleteLabel(DeleteLabelType.All)}
                    disabled={selectedLabel.length === 0}
                    type='primary'
                  >
                    刪除全部幀
                  </Button>
                  <Button
                    onClick={() => handleDeleteLabel(DeleteLabelType.Before)}
                    disabled={selectedLabel.length === 0}
                    type='primary'
                  >
                    刪除此幀(含)以前
                  </Button>
                  <Button
                    onClick={() => handleDeleteLabel(DeleteLabelType.After)}
                    disabled={selectedLabel.length === 0}
                    type='primary'
                  >
                    刪除此幀(含)以後
                  </Button>
                </Space>
              </div>
            </div>
          </Col>
        </Row>
      </Content>
    </Layout>
  )
}

export default App

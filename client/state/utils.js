import React from 'react'
import Store from 'state/main'
var srcDir = require('config').srcDir
var SVGInjector = require('svg-injector')
var colorPaletteUtils = require('../common/colorPaletteUtils')
var toA = colorPaletteUtils.toA
var setSvgColors = colorPaletteUtils.setSvgColors

function currentYearTwoDigits() {
  return parseInt(
    String(new Date().getFullYear()).substr(2, 2)
  )
}

function getCurrentMonth() {
  return (new Date().getUTCMonth()) + 1
}

var svgTextToImage = (svgEl) => {
  var svgString = (new window.XMLSerializer()).serializeToString(svgEl)
  var imageString = 'data:image/svg+xml;base64,' + window.btoa(svgString)
  var img = new Image()
  img.height = 400
  img.width = 400
  img.src = imageString
  return img
}

export default {

  imagePath: (name) => `/${srcDir}/images/${name}`,
  iconPath: (name) => `/${srcDir}/images/icons/${name}`,
  surfacePath: (name) => `/${srcDir}/images/surfaces/${name}`,
  toA: toA,
  svgLayerIds: colorPaletteUtils.svgLayerIds,

  isInvalidEditStep: (validSteps, step, layerStep) => {
    var retVal = false
    if (step == null) {
      if (layerStep != null &&
          !(layerStep === 'images' || layerStep === 'colors')) {
        retVal = true
      }
    } else {
      if (!validSteps.contains(step)) { retVal = true }
    }
    return retVal
  },

  setSvgColors: setSvgColors,

  replaceSvgImageWithText(containerRef, imgRef, layer) {
    if (containerRef == null || imgRef == null) { return }
    var container = React.findDOMNode(containerRef)
    var img = React.findDOMNode(imgRef)
    var imgClone = img.cloneNode()
    imgClone.removeAttribute('data-reactid')
    var currentSvg = container.querySelector('svg')
    if (currentSvg != null) {
      container.removeChild(currentSvg)
    }
    container.appendChild(imgClone)
    SVGInjector(imgClone, {each: function(svgEl) {
      Store.actions.layerReplacementComplete()
      if (typeof svgEl !== 'object') { return null }
      /*svgEl.style.height = '100%';
      svgEl.style.width = '100%';
      svgEl.style.margin  = '0 auto';*/
      svgEl.style.display = 'block';
      setSvgColors(svgEl, layer)
      return svgEl
    }, evalScripts:'never'});
  },

  svgTextToImage: svgTextToImage,

  renderDesignToJpegDataUrl(size, svgEls, compositeSvg) {
    var w = size, h = size
    var canvas = document.createElement('canvas')
    canvas.height = h
    canvas.width = w
    var svgs = (
      toA(svgEls).map(svg => {
        svg.setAttribute('height', String(h))
        svg.setAttribute('width', String(w))
        return svg
      })
      .map(svgTextToImage)
    )

    var ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    var bgColor = '#fff'
    svgs.forEach(svg => {
      ctx.drawImage(svg, 0, 0, w, h)
    })

    if (compositeSvg) {
      ctx.globalCompositeOperation = 'multiply'
      compositeSvg.setAttribute('height', String(h))
      compositeSvg.setAttribute('width', String(w))
      let compositeSvg = svgTextToImage(compositeSvg)
      ctx.drawImage(compositeSvg, 0, 0, w, h)
    }
    //Draw a white background.
    ctx.globalCompositeOperation = "destination-over"
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 1.0)
  },

  compositeTwoImages(size, baseImg, topImg) {
    baseImg.setAttribute('height', String(size))
    baseImg.setAttribute('width', String(size))
    baseImg = svgTextToImage(baseImg)
    topImg.setAttribute('height', String(size))
    topImg.setAttribute('width', String(size))
    topImg = svgTextToImage(topImg)
    var w = size, h = size
    var canvas = document.createElement('canvas')
    canvas.height = h
    canvas.width = w
    var ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'multiply'
    var bgColor = '#fff'
    ctx.drawImage(baseImg, 0, 0, w, h)
    ctx.drawImage(topImg, 0, 0, w, h)
    // Draw a white background.
    ctx.globalCompositeOperation = "destination-over"
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 1.0)
  },

  loadSvgInline(size, imgUrl, cb) {
    var id = 'to-replace'
    var img = new Image(size, size)
    img.onload = () => {
      var idStr = '#'+id
      var domImg = document.querySelector('#'+id)
      SVGInjector(domImg, {each: (svgEl) => {
        svgEl.setAttribute('height', String(size))
        svgEl.setAttribute('width', String(size))
        var imageAsDataUri = svgTextToImage(svgEl)
        imageAsDataUri.height = String(size)
        imageAsDataUri.width = String(size)
        cb(imageAsDataUri)
      }, evalScripts:'never'});
    }
    img.src = imgUrl
    img.style.display = 'none'
    img.id = id
    var oldImg = document.querySelector('#'+id)
    if (oldImg) {
      document.body.removeChild(oldImg)
    }
    document.body.appendChild(img)
  },

  isValidCreditCardNumber(num) {
    num = num.replace(/\s/g, '')
    if (num.length !== 16) {
      return false
    }
    return true
  },

  isValidEmail(val) {
    var re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,30}/i
    return re.test(val)
  },

  hasValidLength(val) {
   return val.length > 0
  },

  hasValidZipcodeLength(val) {
    return val.length >= 5
  },

  isValidExpiryDate(val) {
    var [month, year] = val.split('/')
    month = parseInt(month)
    year = parseInt(year)
    var currentYear = currentYearTwoDigits()
    var currentMonth = getCurrentMonth()
    if (isNaN(month) || isNaN(year)) {
      return false
    }
    return true
  },

  isValidMonth(val) {
    var [month, year] = val.split('/')
    month = parseInt(month)
    return (month === 0 || month > 12) ? false : true
  },

  isExpiryInPast(val) {
    var [month, year] = val.split('/')
    month = parseInt(month)
    year = parseInt(year)
    var currentYear = currentYearTwoDigits()
    var currentMonth = getCurrentMonth()
    if (year < currentYear) { return true }
    if (year === currentYear && month < currentMonth) {
      return true
    }
    return false
  }
}

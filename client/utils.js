import {credsRef} from 'state/firebaseRefs'
import reactor from 'state/reactor'
import getters from 'state/getters'
var config = require('config')
var pako = require('pako')
var srcDir = config.srcDir
import {Set} from 'Immutable'
import Promise from 'bluebird'
var s3Endpoint = config.s3Endpoint
var designPreviewSize = config.designPreviewSize
var designDetailSize = config.designDetailSize
var s3BucketName = config.s3BucketName
var imgHostname = config.imgHostname
/**
 * From: https://gist.github.com/mikelehen/3596a30bd69384624c11
 * Fancy ID generator that creates 20-character string identifiers with the following properties:
 *
 * 1. They're based on timestamp so that they sort *after* any existing ids.
 * 2. They contain 72-bits of random data after the timestamp so that IDs won't
 *    collide with other clients' IDs.
 * 3. They sort *lexicographically* (so the timestamp is converted to characters that will sort properly).
 * 4. They're monotonically increasing.  Even if you generate more than one in the same timestamp, the
 *    latter ones will sort after the former ones.  We do this by using the previous random bits
 *    but "incrementing" them by 1 (only in the case of a timestamp collision).
 */
var generateFirebaseID = (function() {
  // Modeled after base64 web-safe chars, but ordered by ASCII.
  var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

  // Timestamp of last push, used to prevent local collisions if you push twice in one ms.
  var lastPushTime = 0;

  // We generate 72-bits of randomness which get turned into 12 characters and appended to the
  // timestamp to prevent collisions with other clients.  We store the last characters we
  // generated because in the event of a collision, we'll use those same characters except
  // "incremented" by one.
  var lastRandChars = [];

  return function() {
    var now = new Date().getTime();
    var duplicateTime = (now === lastPushTime);
    lastPushTime = now;

    var timeStampChars = new Array(8);
    for (var i = 7; i >= 0; i--) {
      timeStampChars[i] = PUSH_CHARS.charAt(now % 64);
      // NOTE: Can't use << here because javascript will convert to int and lose the upper bits.
      now = Math.floor(now / 64);
    }
    if (now !== 0) throw new Error('We should have converted the entire timestamp.');

    var id = timeStampChars.join('');

    if (!duplicateTime) {
      for (i = 0; i < 12; i++) {
        lastRandChars[i] = Math.floor(Math.random() * 64);
      }
    } else {
      // If the timestamp hasn't changed since last push, use the same random number, except incremented by 1.
      for (i = 11; i >= 0 && lastRandChars[i] === 63; i--) {
        lastRandChars[i] = 0;
      }
      lastRandChars[i]++;
    }
    for (i = 0; i < 12; i++) {
      id += PUSH_CHARS.charAt(lastRandChars[i]);
    }
    if(id.length != 20) throw new Error('Length should be 20.');

    return id;
  };
}())

var toA = (list) => Array.prototype.slice.call(list, 0)

var dataUriToBlob = (dataUri) => {
  // convert base64/URLEncoded data component to raw binary data held in a string
  var byteString = (
    (dataUri.split(',')[0].indexOf('base64') >= 0)
    ? atob(dataUri.split(',')[1])
    : unescape(dataUri.split(',')[1])
  )
  // separate out the mime component
  var mimeString = dataUri.split(',')[0].split(':')[1].split(';')[0]
  // write the bytes of the string to a typed array
  var ia = new Uint8Array(byteString.length)
  for (var i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ia], {type:mimeString});
}

var svgTextToImage = (height, width, svgEl) => {
  var svgString = (new window.XMLSerializer()).serializeToString(svgEl)
  var imageString = 'data:image/svg+xml;base64,' + window.btoa(svgString)
  var img = new Image(width, height)
  return new Promise((resolve, reject) => {
    img.addEventListener('load', () => resolve(img))
    img.src = imageString
  })
}

var renderDesignToJpegBlob = (size, svgEls) => {
  var w = size, h = size
  var canvas = document.createElement('canvas')
  canvas.height = h
  canvas.width = w
  var ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, w, h)
  var bgColor = '#fff'

  var svgs = (
    toA(svgEls).map(svg => {
      svg.setAttribute('height', String(h))
      svg.setAttribute('width', String(w))
      return svg
    })
    .map(svgTextToImage.bind(null, h, w)))

  return Promise.all(svgs).then(svgImgs => {
    svgImgs.forEach(svg => { ctx.drawImage(svg, 0, 0, w, h) })
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, w, h)
    return dataUriToBlob(canvas.toDataURL('image/jpeg', 1.0))
  })
}

var s3UrlForImage = (filename) => {
  return `${s3Endpoint}/${s3BucketName}/${filename}`
}

var urlForImage = (filename) => {
  return imgHostname + '/images/' + filename
}

var imageUrlForLayerImage = (layerImage) => {
  var filename = layerImage.get('imageUrl').split('/').pop()
  return urlForImage(filename)
}

var uploadImgToS3 = (file, filename, imgType) => {
  var body = file
  if (imgType === 'image/svg+xml') {
    body = pako.gzip(file)
  }
  return new Promise((resolve, reject) => {
    credsRef.once('value', snapshot => {
      var creds = snapshot.val()
      AWS.config.credentials = {
        accessKeyId: creds.s3AccessKey,
        secretAccessKey: creds.s3SecretKey}
      var params = {
        Bucket: s3BucketName,
        Key: filename,
        ACL: 'public-read',
        CacheControl: 'max-age: 45792000',
        ContentType: imgType,
        Body: body}

      if (imgType === 'image/svg+xml') {
        params.ContentEncoding = 'gzip'
      }
      var s3 = new AWS.S3()
      s3.putObject(params, (err, d) => {
        if (err) {
          console.log('got error: ',err)
          reject(new Error('Failed to upload to s3.'))
        } else {
          resolve(urlForImage(filename))
        }
      })
    })
  })
}

function numTagsInCommon(obj1, obj2) {
  var tags1 = Set(obj1.get('tags'))
  var tags2 = Set(obj2.get('tags'))
  return tags1.intersect(tags2).count()
}

var _recomputeLayerImagesForLayer = (layer) => {
  var allLayerImages = reactor.evaluate(getters.layerImagesUnsorted)
  var orderedLayerImages = allLayerImages.sort((li1, li2) => {
    return numTagsInCommon(layer, li2) - numTagsInCommon(layer, li1)
  })
  orderedLayerImages = orderedLayerImages.map(li => li.get('id'))
  var selectedLayerImageId = layer.getIn(['selectedLayerImage', 'id'])
  var index = orderedLayerImages.findIndex(li => li === selectedLayerImageId)
  return (layer.set('layerImages', orderedLayerImages)
               .set('selectedLayerImageIndex', index))
}

export default {
  renderDesignToJpegBlob:renderDesignToJpegBlob,
  recomputeLayerImagesForLayer:_recomputeLayerImagesForLayer,
  numTagsInCommon: numTagsInCommon,

  imageUrlForDesign(design, size) {
    var filename;
    if (size === 'small') {
      filename = design.get('smallImageUrl').split('/').pop()
    } else if (size === 'large') {
      filename = design.get('largeImageUrl').split('/').pop()
    } else {
      filename = (design.has('title')
          ? design.get('title')
          : design.get('imageUrl').split('/').pop())
    }
    return urlForImage(filename, 'jpg')
  },

  imageUrlForLayer(layer) {
    return imageUrlForLayerImage(layer.get('selectedLayerImage'))
  },
  compositeImageUrlForLayer(layer) {
    return layer.getIn(['selectedLayerImage', 'compositeImageUrl'])
                .replace('/assets/images/new/', '/' + srcDir + '/images/layers/')
  },
  imageUrlForLayerImage: imageUrlForLayerImage,

  imageUrlForSurface(surface) {
    if (surface == null) { return null }
    return surface.get('imageUrl').replace(/^.*:\/\//, '//')
  },
  newId: generateFirebaseID,

  s3UrlForImage: s3UrlForImage,

  uploadImgToS3: uploadImgToS3,

  uploadDesignPreview(title, svgEls) {
    if (TEST) {
      return new Promise((res, rej) => {
        res(['smallImageUrl', 'largeImgUrl'])
      })
    }
    return Promise.all([
      renderDesignToJpegBlob(designPreviewSize, svgEls),
      renderDesignToJpegBlob(designDetailSize, svgEls)
    ]).then(([designJpgBlobSmall, designJpgBlobLarge]) => {
      return Promise.all([
        uploadImgToS3(designJpgBlobSmall, title + '-small.jpg', 'image/jpeg'),
        uploadImgToS3(designJpgBlobLarge, title + '-large.jpg', 'image/jpeg')
      ])
    })
  },

  rotateColorPalette(design, layer, layerIndex) {
    var layers = design.get('layers')
    layer = layer || layers.get(layerIndex)
    var index = typeof layerIndex === 'undefined' ?
      layers.findIndex(l => l.get('id') === layer.get('id'))
      : layerIndex
    var currentRotation = layer.get('paletteRotation')
    // 0 - 3
    var nextRotation = (currentRotation + 1) % 4
    var newLayers = layers.update(index, v => v.set('paletteRotation', nextRotation))
    return design.set('layers', newLayers)
  },

  /**
   * Makes a copy of the passed in design where the new design has its own
   * id, each layer has a new id, and has a `copiedFromDesign` set to the
   * id of the passed in design.
   */
  makeDesignCopy(design) {
    return design.update(d => {
      var newLayers = d.get('layers').map(l => l.set('id', generateFirebaseID()))
      var now = new Date().getTime()
      return d.withMutations(d2 => {
        d2.set('id', generateFirebaseID())
          .set('adminCreated', false)
          .set('layers', newLayers)
          .set('createdAt', now)
          .set('updatedAt', now)
          .set('copiedFromDesign', design.get('id'))
      })
    })
  },

  getPrintDesignImageUrl(design, prop) {
    const imgUrl = design.getIn(['surfaceImages', prop])
    const parts = imgUrl.split('.')
    const fileType = parts.pop()
    return `${parts.join('.')}-small.${fileType}`
  },

  surfaceTypeToDescription(type) {
    switch (type) {
      case 'framedCanvas':
        return {
          surfaceInfo: '6” \u00d7 6” framed canvas',
          price: '$40'
        }
      case 'framedPrint':
        return {
          surfaceInfo:  '12” \u00d7 12” framed print',
          price: '$50'
        }
      default:
        return null
    }
  }
}

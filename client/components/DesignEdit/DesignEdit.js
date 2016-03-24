import React from 'react'
import reactor from 'state/reactor'
import Router from 'react-router'
import actions from 'state/actions'
import getters from 'state/getters'
import {makeDesignCopy} from 'state/utils'
import RenderLayers from 'components/Design/RenderLayers/RenderLayers'
import LayerSelectorGroup from 'components/Design/LayerSelectorGroup/LayerSelectorGroup'
import ColorsButton from 'components/ColorsButton/ColorsButton'
import CheckButton from 'components/CheckButton/CheckButton'
import {renderLayersSelector} from '../../../../common/constants'

export default React.createClass({
  mixins: [reactor.ReactMixin, Router.State, Router.Navigation],

  getDataBindings() {
    return {
      design: getters.currentDesign,
      currentLayer: getters.currentLayer,
      numEnabledLayers: getters.numEnabledLayers
    }
  },

  _designIsNotEditable() {
    return (
      this.state.design != null &&
      this.state.design.get('isImmutable') &&
      !this._isTransitioning
    )
  },

  _makeEditableCopyAndTransition() {
    this._isTransitioning = true
    var newDesign = makeDesignCopy(this.state.design).set('isImmutable', false)
    actions.saveNewDesign(newDesign)
    this.transitionTo('designEdit', {
      designId: newDesign.get('id'),
      layerId: newDesign.getIn(['layers', 0, 'id'])
    })
    actions.selectDesignAndLayerId({
      designId: newDesign.get('id'),
      layerId: newDesign.getIn(['layers', 0, 'id'])
    })
  },

  componentWillMount() {
    this._isTransitioning = false
    if (this._designIsNotEditable()) {
      this._makeEditableCopyAndTransition()
    } else {
      actions.selectDesignAndLayerId({
        designId: this.props.params.designId,
        layerId: this.props.params.layerId
      })
    }
  },

  componentWillUnmount() {
    clearInterval(this._interval)
  },

  componentWillUpdate() {
    if (this._designIsNotEditable()) {
      this._makeEditableCopyAndTransition()
    }
  },

  shouldComponentUpdate(nextProps, nextState) {
    return nextProps !== this.props || nextState !== this.state
  },

  attemptLoadResources() {
    this._interval = setInterval(() => {
      var svgs = document.querySelectorAll(renderLayersSelector)
      if (svgs.length === this.state.numEnabledLayers) {
        clearInterval(this._interval)
        actions.loadCurrentDesignEditResources()
      }
    }, 50)
  },

  componentDidMount() {
    this.attemptLoadResources()
  },

  toggleCurrentLayer(e) {
    e.preventDefault()
    actions.toggleCurrentLayer()
  },

  editLayerDetail() {
    this.transitionTo('designEditDetail', {
      designId: this.state.design.get('id'),
      layerId: this.state.currentLayer.get('id'),
      imagesOrColors: 'images'
    })
  },

  editDesignSurface() {
    this.transitionTo('designEditSurface', { designId: this.state.design.get('id') })
  },

  onSelectLayer(layerId) {
    reactor.dispatch('selectLayerId', layerId)
    this.transitionTo('designEdit', {
      designId: this.state.design.get('id'),
      layerId: layerId
    })
  },

  render() {
    if (this.state.design == null || this.state.currentLayer == null) { return null }
    return (
      <section className="DesignEdit">

        <div className="DesignEdit__SectionOne">
          <RenderLayers layers={this.state.design.get('layers')} />
        </div>

        <div className="DesignEdit__SectionTwo">
          <div className="DesignEdit__buttons">
            <ColorsButton isSmall={false}
               onLeftClick={actions.previousDesignColors}
               onRightClick={actions.nextDesignColors}/>
            <CheckButton onClick={this.editDesignSurface} isSmall={false}/>
          </div>

          <LayerSelectorGroup onClick={this.onSelectLayer}/>
        </div>

      </section>
    )
  }
})
